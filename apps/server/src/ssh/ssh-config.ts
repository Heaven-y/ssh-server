// 解析 ~/.ssh/config：只支持本工具需要的子集，其余选项记为不支持
import path from 'node:path';
import type { SshHostInfo } from '@ssh-server/shared';

export type SshHostConfig = {
  alias: string;
  hostname: string;
  port: number;
  user?: string;
  identityFiles: string[];
  /** 本工具暂不支持、但配置中出现的选项（如 ProxyJump） */
  unsupported: string[];
};

type Option = { key: string; value: string };
type Block = { patterns: string[]; options: Option[]; skip: boolean };
export type ParsedSshConfig = { blocks: Block[]; homeDir: string; globalUnsupported: string[] };

const SUPPORTED = new Set(['hostname', 'port', 'user', 'identityfile']);
/** 影响连接方式、但本工具没有实现的选项 */
const UNSUPPORTED = new Map([
  ['proxyjump', 'ProxyJump'],
  ['proxycommand', 'ProxyCommand'],
  ['include', 'Include'],
  ['certificatefile', 'CertificateFile'],
]);

/** 按空白拆分，支持双引号包裹含空格的值 */
function splitWords(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (const m of s.matchAll(re)) out.push(m[1] ?? m[2] ?? '');
  return out;
}

/** 解析一行为 关键字 + 值，支持 `Key value` 与 `Key=value` */
function parseLine(line: string): { key: string; rest: string } | undefined {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return undefined;
  const m = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(trimmed);
  if (!m) return { key: trimmed.toLowerCase(), rest: '' };
  return { key: m[1]!.toLowerCase(), rest: m[2]!.trim() };
}

export function parseSshConfig(text: string, homeDir: string): ParsedSshConfig {
  const blocks: Block[] = [];
  const globalUnsupported: string[] = [];
  // Host 之前的选项对所有主机生效
  let current: Block = { patterns: ['*'], options: [], skip: false };
  blocks.push(current);

  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const parsed = parseLine(raw);
    if (!parsed) continue;
    const { key, rest } = parsed;
    if (key === 'host') {
      current = { patterns: splitWords(rest), options: [], skip: false };
      blocks.push(current);
    } else if (key === 'match') {
      current = { patterns: [], options: [], skip: true };
      blocks.push(current);
    } else if (key === 'include') {
      globalUnsupported.push('Include');
    } else if (!current.skip) {
      const value = splitWords(rest).join(' ');
      current.options.push({ key, value });
    }
  }
  return { blocks, homeDir, globalUnsupported };
}

const hasWildcard = (p: string) => /[*?]/.test(p);

function patternMatches(pattern: string, alias: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return re.test(alias);
}

/** OpenSSH 规则：! 开头的模式命中则整个块不匹配 */
function blockMatches(block: Block, alias: string): boolean {
  if (block.skip) return false;
  let matched = false;
  for (const p of block.patterns) {
    if (p.startsWith('!')) {
      if (patternMatches(p.slice(1), alias)) return false;
    } else if (patternMatches(p, alias)) {
      matched = true;
    }
  }
  return matched;
}

function expandHome(p: string, homeDir: string): string {
  if (p === '~') return homeDir;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homeDir, p.slice(2));
  return p.replace(/%d/g, homeDir);
}

/** 解析某个别名的连接参数；没有任何非通配符 Host 匹配时返回 undefined */
export function resolveHost(cfg: ParsedSshConfig, alias: string): SshHostConfig | undefined {
  const explicit = cfg.blocks.some(
    (b) => blockMatches(b, alias) && b.patterns.some((p) => !p.startsWith('!') && !hasWildcard(p)),
  );
  if (!explicit) return undefined;

  const values = new Map<string, string>();
  const identityFiles: string[] = [];
  const unsupported = new Set(cfg.globalUnsupported);

  for (const block of cfg.blocks) {
    if (!blockMatches(block, alias)) continue;
    for (const { key, value } of block.options) {
      if (key === 'identityfile') {
        identityFiles.push(expandHome(value, cfg.homeDir));
      } else if (SUPPORTED.has(key)) {
        if (!values.has(key)) values.set(key, value); // 先出现的值优先
      } else if (UNSUPPORTED.has(key)) {
        unsupported.add(UNSUPPORTED.get(key)!);
      }
    }
  }

  const port = Number(values.get('port') ?? 22);
  return {
    alias,
    hostname: values.get('hostname') ?? alias,
    port: Number.isInteger(port) && port > 0 ? port : 22,
    user: values.get('user'),
    identityFiles,
    unsupported: [...unsupported],
  };
}

/** 列出可选的 Host（不含通配符模式） */
export function listHosts(cfg: ParsedSshConfig): SshHostInfo[] {
  const aliases: string[] = [];
  for (const b of cfg.blocks) {
    if (b.skip) continue;
    for (const p of b.patterns) {
      if (!p.startsWith('!') && !hasWildcard(p) && !aliases.includes(p)) aliases.push(p);
    }
  }
  return aliases.flatMap((alias) => {
    const h = resolveHost(cfg, alias);
    return h ? [{ alias, hostname: h.hostname, user: h.user, port: h.port, unsupported: h.unsupported }] : [];
  });
}
