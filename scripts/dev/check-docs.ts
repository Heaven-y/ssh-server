// 文档一致性检查：坏链/坏锚点、跨文档重复长句、docs 导航完整性，以及单文档行数软预警。
// 用法：node --import tsx scripts/dev/check-docs.ts
// 只检查 git 跟踪的 Markdown；第三方 skill 与本地执行记录（.agents/、.superpowers/）不在范围内。
// 门槛说明见 docs/guides/dev-environment.md 1.3。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 单文档行数软阈值：超过只提示不失败，避免为压行数做坏拆分。 */
const SOFT_LINE_LIMIT = 600;
/** 跨文档重复长句的最短长度（字符）。 */
const DUPLICATE_MIN_LENGTH = 40;
/** docs 导航文件的 git 路径。 */
const DOCS_INDEX = 'docs/README.md';
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const HEADING = /^#{1,6}\s+(.*)$/;
const SENTENCE_BREAK = /[。；;!?？]/;
const FENCE = /^```/;

type Doc = { path: string; text: string };
type Problem = { file: string; detail: string };

/** 取 git 跟踪的 Markdown 路径（正斜杠，与平台无关）。 */
function trackedDocs(): string[] {
  const out = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 去掉围栏代码块，只保留正文行，避免把示例代码当成链接或句子。 */
function proseLines(text: string): string[] {
  const kept: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return kept;
}

/** 按 GitHub 规则生成标题锚点：小写、去掉标点、空格转连字符。 */
function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\- ]/gu, '')
    .replace(/ /g, '-');
}

const anchorCache = new Map<string, Set<string>>();

/** 目标文档的标题锚点集合，按路径缓存。 */
function anchorsOf(path: string): Set<string> {
  const cached = anchorCache.get(path);
  if (cached) return cached;
  const anchors = new Set<string>();
  for (const line of proseLines(readFileSync(path, 'utf8'))) {
    const heading = HEADING.exec(line)?.[1];
    if (heading) anchors.add(slugify(heading));
  }
  anchorCache.set(path, anchors);
  return anchors;
}

function decodeAnchor(raw: string): string {
  if (!raw.includes('%')) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 收集文档内的相对链接目标；站外链接不参与检查。 */
function linkTargets(doc: Doc): string[] {
  const targets: string[] = [];
  for (const line of proseLines(doc.text)) {
    for (const match of line.matchAll(LINK)) {
      const target = match[1];
      if (target && !/^(https?:|mailto:)/.test(target)) targets.push(target);
    }
  }
  return targets;
}

/** 单个链接的问题描述；没有问题返回 undefined。 */
function linkIssue(from: string, target: string): string | undefined {
  const [filePart = '', rawAnchor = ''] = target.split('#');
  const resolved = filePart ? resolve(dirname(from), filePart) : resolve(from);
  if (filePart && !existsSync(resolved)) return `链接目标不存在：${target}`;
  if (!rawAnchor || !resolved.endsWith('.md')) return undefined;
  return anchorsOf(resolved).has(decodeAnchor(rawAnchor)) ? undefined : `锚点不存在：${target}`;
}

function checkLinks(docs: Doc[]): Problem[] {
  const problems: Problem[] = [];
  for (const doc of docs) {
    for (const target of linkTargets(doc)) {
      const issue = linkIssue(doc.path, target);
      if (issue) problems.push({ file: doc.path, detail: issue });
    }
  }
  return problems;
}

/** 把文档切成候选长句，用于跨文档重复检测。 */
function longSentences(text: string): string[] {
  const found: string[] = [];
  for (const line of proseLines(text)) {
    for (const part of line.split(SENTENCE_BREAK)) {
      const sentence = part.trim();
      if (sentence.length >= DUPLICATE_MIN_LENGTH) found.push(sentence);
    }
  }
  return found;
}

/** 同一长句出现在多个文档时报告：这正是参数重复定义的典型来源。 */
function checkDuplicates(docs: Doc[]): Problem[] {
  const owners = new Map<string, Set<string>>();
  for (const doc of docs) {
    for (const sentence of longSentences(doc.text)) {
      const files = owners.get(sentence) ?? new Set<string>();
      files.add(doc.path);
      owners.set(sentence, files);
    }
  }
  const problems: Problem[] = [];
  for (const [sentence, files] of owners) {
    if (files.size > 1) problems.push({ file: [...files].join('、'), detail: `跨文档重复长句：${sentence}` });
  }
  return problems;
}

/** docs/ 下的每个文档都必须出现在导航里，避免新增文档成为孤儿。 */
function checkDocsIndex(docs: Doc[]): Problem[] {
  const index = docs.find((doc) => doc.path === DOCS_INDEX);
  if (!index) return [{ file: DOCS_INDEX, detail: '缺少文档导航文件' }];
  const linked = new Set(linkTargets(index).map((target) => resolve(dirname(index.path), target.split('#')[0] ?? '')));
  const problems: Problem[] = [];
  for (const doc of docs) {
    if (doc.path === index.path || !doc.path.startsWith('docs/')) continue;
    if (!linked.has(resolve(doc.path))) problems.push({ file: doc.path, detail: `未在 ${DOCS_INDEX} 中登记` });
  }
  return problems;
}

/** 行数只做预警：拆分与否取决于是否重复或混入过程流水，不能只看长度。 */
function lineWarnings(docs: Doc[]): string[] {
  return docs
    .map((doc) => ({ path: doc.path, lines: doc.text.replace(/\n$/, '').split('\n').length }))
    .filter((item) => item.lines > SOFT_LINE_LIMIT)
    .map((item) => `${item.path} 共 ${item.lines} 行，超过软阈值 ${SOFT_LINE_LIMIT}；先确认重复与过程流水，再考虑拆分`);
}

const docs = trackedDocs().map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const failures = [...checkLinks(docs), ...checkDuplicates(docs), ...checkDocsIndex(docs)];
const warnings = lineWarnings(docs);

console.log(`检查 ${docs.length} 个受版本控制的 Markdown 文档`);
for (const warning of warnings) console.log(`预警：${warning}`);
for (const failure of failures) console.error(`失败：${failure.file}：${failure.detail}`);
if (failures.length > 0) {
  console.error(`文档一致性检查未通过：${failures.length} 处问题`);
  process.exitCode = 1;
} else {
  console.log('文档一致性检查通过：链接与锚点有效、无跨文档重复长句、docs 导航完整');
}
