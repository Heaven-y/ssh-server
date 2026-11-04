// 三个 CLI 的会话归属裁决：只比较路径字符串，不访问磁盘，解析不出来就返回 null。
//
// 归一规则沿用 agents/session-scope.ts 的 sameSessionDirectory：
// 绝对路径 + 分隔符统一 + Windows 大小写不敏感。这里不调用它，
// 因为归属裁决必须是同步纯函数，而 sameSessionDirectory 会 realpath 访问磁盘。
import path from 'node:path';
import type { Workspace } from '@agentdeck/shared';

/** 归一后的绝对路径；separator 用于判断「父目录 + 分隔符」前缀，避免 demo 匹配到 demo-2。 */
type NormalizedDirectory = { value: string; separator: '\\' | '/' };

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC = /^\\\\[^\\]/;
// file URI 的 pathname 是 `/E:/...`，剥掉前导斜杠后才是 Windows 盘符路径。
const URI_DRIVE_PATH = /^\/[A-Za-z]:[\\/]/;

function normalizeDirectory(value: string): NormalizedDirectory | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (WINDOWS_DRIVE.test(trimmed) || WINDOWS_UNC.test(trimmed)) {
    // 用 win32 规则而不是宿主平台规则：同一份配置在 Linux 上跑测试也要得到一致裁决。
    return { value: path.win32.resolve(trimmed).toLowerCase(), separator: '\\' };
  }
  if (trimmed.startsWith('/')) {
    // POSIX 路径区分大小写，不能跟着 Windows 一起转小写。
    return { value: path.posix.resolve(trimmed), separator: '/' };
  }
  return null;
}

/** 只接受 file:// 的本地 URI；https、相对路径、损坏的百分号编码都返回 null。 */
function localPathFromUri(raw: string): NormalizedDirectory | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'file:') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (url.hostname && url.hostname !== 'localhost') {
    // file://server/share 是 UNC 路径，不是「解析不出来」。
    return normalizeDirectory(`\\\\${url.hostname}${decoded.replaceAll('/', '\\')}`);
  }
  return normalizeDirectory(URI_DRIVE_PATH.test(decoded) ? decoded.slice(1) : decoded);
}

function isSameOrInside(candidate: NormalizedDirectory, root: NormalizedDirectory): boolean {
  if (candidate.separator !== root.separator) return false;
  if (candidate.value === root.value) return true;
  // 根目录本身以分隔符结尾（如 C:\ 或 /），不能重复拼一个分隔符。
  const prefix = root.value.endsWith(root.separator) ? root.value : `${root.value}${root.separator}`;
  return candidate.value.startsWith(prefix);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * 解析 Antigravity 的 workspace_uris：可能是 JSON 字符串数组、换行/分号分隔，
 * 也可能只是一个值。只做拆分与去空白，URI 到本地路径的转换留给归属裁决。
 */
export function parseWorkspaceUris(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const parsed = parseJson(text);
  if (Array.isArray(parsed)) {
    const values = parsed.filter((item): item is string => typeof item === 'string');
    if (values.length === parsed.length) return values.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof parsed === 'string') {
    const value = parsed.trim();
    return value ? [value] : [];
  }
  return text
    .split(/[\r\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 归给配置顺序最靠前的命中项目；一个会话只属于一个项目。
 * cwd 与 workspace_uris 都是候选路径，任一命中即可；全都解析不出来时返回 null，
 * 绝不回退到第一个项目——那会把别人的会话显示在错误项目下。
 */
export function resolveProjectId(input: {
  cwd?: string;
  workspaceUris?: string;
  projects: Workspace[];
}): string | null {
  const candidates = [
    ...(input.cwd ? [normalizeDirectory(input.cwd)] : []),
    ...parseWorkspaceUris(input.workspaceUris ?? '').map(localPathFromUri),
  ].filter((item): item is NormalizedDirectory => item !== null);
  if (candidates.length === 0) return null;
  for (const project of input.projects) {
    const root = normalizeDirectory(project.dir);
    if (root && candidates.some((candidate) => isSameOrInside(candidate, root))) return project.id;
  }
  return null;
}
