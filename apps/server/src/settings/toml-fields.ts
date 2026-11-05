import { getStaticTOMLValue, parseTOML, type AST } from 'toml-eslint-parser';

export type TomlFieldEdit = { path: string[]; value: string | number | boolean | null };
type Field = { path: string[]; node: AST.TOMLKeyValue };
type Container = {
  path: string[];
  node: AST.TOMLTopLevelTable | AST.TOMLTable | AST.TOMLInlineTable;
};
type Index = { fields: Field[]; containers: Container[]; arrays: string[][] };
type Patch = { range: AST.Range; text: string };
const UNSUPPORTED = '无法安全更新 TOML 配置，请使用原文编辑。';

const prefix = (parent: string[], child: string[]) =>
  parent.length <= child.length && parent.every((key, index) => key === child[index]);
const samePath = (left: string[], right: string[]) => left.length === right.length && prefix(left, right);
const stringValue = (value: string) => JSON.stringify(value).replace(/\u007f/g, '\\u007f');
const keyText = (keys: string[]) => keys.map((key) => (/^[\w-]+$/u.test(key) ? key : stringValue(key))).join('.');

function indexFields(program: AST.TOMLProgram): Index {
  const root = program.body[0];
  const index: Index = { fields: [], containers: [{ path: [], node: root }], arrays: [] };
  const addField = (node: AST.TOMLKeyValue, parent: string[]) => {
    const path = [...parent, ...getStaticTOMLValue(node.key)];
    index.fields.push({ path, node });
    if (node.value.type !== 'TOMLInlineTable') return;
    index.containers.push({ path, node: node.value });
    for (const entry of node.value.body) addField(entry, path);
  };
  for (const node of root.body) {
    if (node.type === 'TOMLKeyValue') {
      addField(node, []);
      continue;
    }
    const arrayPosition = node.resolvedKey.findIndex((part) => typeof part === 'number');
    if (arrayPosition >= 0) {
      index.arrays.push(node.resolvedKey.slice(0, arrayPosition).filter((part) => typeof part === 'string'));
      continue;
    }
    const path = node.resolvedKey.filter((part) => typeof part === 'string');
    index.containers.push({ path, node });
    for (const entry of node.body) addField(entry, path);
  }
  return index;
}

function patchText(content: string, patches: Patch[]): string {
  return patches
    .sort((left, right) => right.range[0] - left.range[0])
    .reduce((result, patch) => result.slice(0, patch.range[0]) + patch.text + result.slice(patch.range[1]), content);
}

function removeField(program: AST.TOMLProgram, node: AST.TOMLKeyValue): Patch[] {
  const patches: Patch[] = [{ range: node.range, text: '' }];
  if (node.parent.type !== 'TOMLInlineTable' || node.parent.body.length === 1) return patches;
  const siblings = node.parent.body;
  const position = siblings.indexOf(node);
  const next = siblings[position + 1];
  const previous = siblings[position - 1];
  const start = next ? node.range[1] : previous!.range[1];
  const end = next ? next.range[0] : node.range[0];
  const comma = program.tokens.find(
    (token) => token.type === 'Punctuator' && token.value === ',' && token.range[0] >= start && token.range[1] <= end,
  );
  if (!comma) throw new Error(UNSUPPORTED);
  // 分开移除字段与分隔符，原有空白和注释仍保留在原处。
  patches.push({ range: comma.range, text: '' });
  return patches;
}

function insertInline(container: AST.TOMLInlineTable, entry: string): Patch {
  const last = container.body.at(-1);
  const offset = last ? last.range[1] : container.range[0] + 1;
  return { range: [offset, offset], text: `${last ? ', ' : ''}${entry}` };
}

function insertField(content: string, program: AST.TOMLProgram, container: Container, edit: TomlFieldEdit): Patch {
  const keys = edit.path.slice(container.path.length);
  const value = typeof edit.value === 'string' ? stringValue(edit.value) : String(edit.value);
  const entry = `${keyText(keys)} = ${value}`;
  if (container.node.type === 'TOMLInlineTable') return insertInline(container.node, entry);
  const sectionStart = container.node.type === 'TOMLTopLevelTable' ? -1 : container.node.range[0];
  const next = program.body[0].body.find((node) => node.type === 'TOMLTable' && node.range[0] > sectionStart);
  // 插入在当前表结束处，确保新字段不会意外落入后一张表。
  const offset = next ? content.lastIndexOf('\n', next.range[0] - 1) + 1 : content.length;
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const leading = offset > 0 && content[offset - 1] !== '\n' ? newline : '';
  return { range: [offset, offset], text: `${leading}${entry}${newline}` };
}

function replaceField(program: AST.TOMLProgram, node: AST.TOMLKeyValue, value: TomlFieldEdit['value']): Patch[] {
  if (node.value.type !== 'TOMLValue') throw new Error(UNSUPPORTED);
  if (value === null) return removeField(program, node);
  if (node.value.value === value) return [];
  const text = typeof value === 'string' ? stringValue(value) : String(value);
  return [{ range: node.value.range, text }];
}

function fieldPatches(content: string, program: AST.TOMLProgram, edit: TomlFieldEdit): Patch[] {
  if (edit.path.length === 0) throw new Error(UNSUPPORTED);
  const index = indexFields(program);
  if (index.arrays.some((path) => prefix(path, edit.path) || prefix(edit.path, path))) throw new Error(UNSUPPORTED);
  const field = index.fields.find((candidate) => samePath(candidate.path, edit.path));
  if (field) return replaceField(program, field.node, edit.value);
  if (index.containers.some((container) => prefix(edit.path, container.path))) throw new Error(UNSUPPORTED);
  if (index.fields.some((candidate) => prefix(edit.path, candidate.path))) throw new Error(UNSUPPORTED);
  if (edit.value === null) return [];
  const parent = index.containers
    .filter((container) => prefix(container.path, edit.path))
    .sort((left, right) => right.path.length - left.path.length)[0]!;
  return [insertField(content, program, parent, edit)];
}

/**
 * TOML 1.0 字段定点编辑：不重新序列化整份配置，未知表、注释和换行保持原样。
 * 数组表路径及容器整体替换不适用本接口；任何不安全结构或语法均明确拒绝。
 */
export function updateTomlFields(content: string, edits: TomlFieldEdit[]): string {
  try {
    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
    let result = content.slice(bom.length);
    let program = parseTOML(result, { tomlVersion: '1.0' });
    for (const edit of edits) {
      result = patchText(result, fieldPatches(result, program, edit));
      // 每次修改都重新确认语义结构，标量祖先、重复表等冲突不能输出到文件。
      program = parseTOML(result, { tomlVersion: '1.0' });
    }
    return bom + result;
  } catch {
    throw new Error(UNSUPPORTED);
  }
}
