import { getStaticTOMLValue, parseTOML, type AST } from 'toml-eslint-parser';
import { parse as parseToml } from 'smol-toml';
import { encodeJson } from '../agents/common/configuration/patch';
import { updateTomlFields } from '../platform/files/toml-fields';
import type { SessionToolsCommand } from './session-tools-command';

export const SESSION_TOOLS_NAME = 'agentdeck_sessions';
export type SessionToolsEntry = SessionToolsCommand & { tools?: { read_session: { eager: true } } };
type ObjectValue = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectValue =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function configurationObject(value: unknown): ObjectValue {
  if (!isObject(value)) throw new Error('配置必须是对象');
  return value;
}
export function parseSessionToolsConfig(content: string, toml: boolean) {
  const raw = content.replace(/^\uFEFF/, '');
  return configurationObject(raw.trim() ? (toml ? parseToml(raw) : (JSON.parse(raw) as unknown)) : {});
}
export function sessionToolsEntry(config: ObjectValue, toml: boolean): unknown {
  const servers = config[toml ? 'mcp_servers' : 'mcpServers'];
  if (servers === undefined) return;
  return configurationObject(servers)[SESSION_TOOLS_NAME];
}
function ownsEnvironment(value: unknown, command: SessionToolsCommand): boolean {
  const env = value ?? {};
  if (!isObject(env)) return false;
  const expected = command.env ?? {};
  return (
    Object.keys(env).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, item]) => env[key] === item)
  );
}
/** 未知字段也视作用户的更改，绝不吞掉自定义权限、远程地址或同名第三方配置。 */
export function ownsSessionToolsEntry(entry: unknown, command: SessionToolsEntry): boolean {
  if (!isObject(entry)) return false;
  const keys = Object.keys(entry);
  if (keys.some((key) => !['command', 'args', 'env', 'type', 'tools'].includes(key))) return false;
  if (entry.type !== undefined && entry.type !== 'stdio') return false;
  if (entry.command !== command.command || JSON.stringify(entry.args) !== JSON.stringify(command.args)) return false;
  return ownsEnvironment(entry.env, command) && JSON.stringify(entry.tools) === JSON.stringify(command.tools);
}

type Field = { path: string[]; node: AST.TOMLKeyValue };
function tomlFields(program: AST.TOMLProgram): Field[] {
  const fields: Field[] = [];
  const add = (node: AST.TOMLKeyValue, parent: string[]) => {
    const path = [...parent, ...getStaticTOMLValue(node.key)];
    fields.push({ node, path });
    if (node.value.type === 'TOMLInlineTable') for (const field of node.value.body) add(field, path);
  };
  for (const node of program.body[0].body) {
    if (node.type === 'TOMLKeyValue') add(node, []);
    else for (const field of node.body) add(field, node.resolvedKey.map(String));
  }
  return fields;
}
const samePath = (path: string[], expected: string[]) =>
  path.length === expected.length && path.every((part, i) => part === expected[i]);
const ownPath = ['mcp_servers', SESSION_TOOLS_NAME];

function removeInlineField(program: AST.TOMLProgram, node: AST.TOMLKeyValue): AST.Range[] {
  if (node.parent.type !== 'TOMLInlineTable' || node.parent.body.length === 1) return [node.range];
  const siblings = node.parent.body;
  const index = siblings.indexOf(node);
  const next = siblings[index + 1];
  const start = next ? node.range[1] : siblings[index - 1]!.range[1];
  const end = next ? next.range[0] : node.range[0];
  const comma = program.tokens.find((token) => token.value === ',' && token.range[0] >= start && token.range[1] <= end);
  if (!comma) throw new Error('无法安全更新 TOML');
  return [node.range, comma.range];
}

function removeTomlEntry(content: string): string {
  const program = parseTOML(content, { tomlVersion: '1.0' });
  const fields = tomlFields(program);
  const entry = fields.find((field) => samePath(field.path, ownPath));
  const ranges: AST.Range[] = entry ? removeInlineField(program, entry.node) : [];
  if (!entry) {
    for (const node of program.body[0].body) {
      if (node.type !== 'TOMLTable' || !ownPath.every((part, index) => node.resolvedKey[index] === part)) continue;
      // 只删除表头与键值，保留该表附近的独立注释。
      ranges.push([node.range[0], content.indexOf(']', node.key.range[1]) + 1]);
    }
    for (const field of fields) {
      if (field.node.parent.type !== 'TOMLInlineTable' && ownPath.every((part, i) => field.path[i] === part))
        ranges.push(field.node.range);
    }
  }
  return ranges
    .sort((a, b) => b[0] - a[0])
    .reduce((result, range) => result.slice(0, range[0]) + result.slice(range[1]), content);
}

function addTomlEntry(content: string, command: SessionToolsCommand): string {
  // 复用既有定位工具处理根表、显式表和内联表，仅将新插入的标量替换为原生内联对象。
  const inserted = updateTomlFields(content, [{ path: ownPath, value: 'agentdeck-entry' }]);
  const field = tomlFields(parseTOML(inserted, { tomlVersion: '1.0' })).find((item) => samePath(item.path, ownPath));
  if (!field) throw new Error('无法安全更新 TOML');
  const values = [`command = ${JSON.stringify(command.command)}`, `args = ${JSON.stringify(command.args)}`];
  if (command.env)
    values.push(
      `env = { ${Object.entries(command.env)
        .map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`)
        .join(', ')} }`,
    );
  return (
    inserted.slice(0, field.node.value.range[0]) +
    `{ ${values.join(', ')} }` +
    inserted.slice(field.node.value.range[1])
  );
}

export function editSessionToolsConfig(
  content: string,
  command: SessionToolsEntry,
  options: { toml: boolean; enabled: boolean },
): string {
  if (options.toml) {
    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
    const raw = content.slice(bom.length);
    const updated = options.enabled ? addTomlEntry(raw, command) : removeTomlEntry(raw);
    parseToml(updated);
    return bom + updated;
  }
  const config = parseSessionToolsConfig(content, false);
  const servers = configurationObject(config.mcpServers ?? {});
  if (options.enabled) servers[SESSION_TOOLS_NAME] = { ...command };
  else delete servers[SESSION_TOOLS_NAME];
  config.mcpServers = servers;
  return encodeJson(content, config);
}
