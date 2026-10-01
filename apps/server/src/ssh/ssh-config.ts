// 读取 ~/.ssh/config：解析与匹配交给 ssh-config 库，这里只做本工具需要的取值与不支持选项提示
import path from 'node:path';
import SSHConfig, { LineType, type Line } from 'ssh-config';
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

export type ParsedSshConfig = { config: SSHConfig; homeDir: string };

/** 影响连接方式、但本工具没有实现的选项（键为小写） */
const UNSUPPORTED = new Map([
  ['proxyjump', 'ProxyJump'],
  ['proxycommand', 'ProxyCommand'],
  ['include', 'Include'],
  ['certificatefile', 'CertificateFile'],
]);

const isSection = (l: Line): l is Extract<Line, { config: unknown }> => l.type === LineType.DIRECTIVE && 'config' in l;

/** Host 行的模式列表（库对带引号的值已去掉引号） */
function hostPatterns(l: Line): string[] {
  if (!isSection(l) || l.param.toLowerCase() !== 'host') return [];
  return (Array.isArray(l.value) ? l.value.map((v) => v.val) : [l.value]).filter(Boolean);
}

/**
 * 解析配置。Match 块依赖运行时条件（本工具不评估），整体去掉，
 * 避免库按条件把其中的选项合并进结果。
 */
export function parseSshConfig(text: string, homeDir: string): ParsedSshConfig {
  const config = SSHConfig.parse(text.replace(/^\uFEFF/, ''));
  for (let i = config.length - 1; i >= 0; i--) {
    const line = config[i]!;
    if (isSection(line) && line.param.toLowerCase() === 'match') config.splice(i, 1);
  }
  return { config, homeDir };
}

const hasWildcard = (p: string) => /[*?]/.test(p);
const isExplicit = (p: string) => !p.startsWith('!') && !hasWildcard(p);

function expandHome(p: string, homeDir: string): string {
  if (p === '~') return homeDir;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homeDir, p.slice(2));
  return p.replace(/%d/g, homeDir);
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const all = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** 配置中显式写出的别名（不含通配符与取反），按出现顺序去重 */
const explicitAliases = (cfg: ParsedSshConfig) => [...new Set(cfg.config.flatMap(hostPatterns).filter(isExplicit))];

/** 解析某个别名的连接参数；别名没有被任何 Host 行显式写出时返回 undefined */
export function resolveHost(cfg: ParsedSshConfig, alias: string): SshHostConfig | undefined {
  if (!explicitAliases(cfg).includes(alias)) return undefined;

  // 库按 OpenSSH 规则匹配（含通配符、! 取反）并让先出现的值优先；键名保留原文大小写
  const computed = Object.fromEntries(
    Object.entries(cfg.config.compute(alias)).map(([k, v]) => [k.toLowerCase(), v]),
  ) as Record<string, string | string[] | undefined>;

  const port = Number(first(computed.port) ?? 22);
  return {
    alias,
    hostname: first(computed.hostname) ?? alias,
    port: Number.isInteger(port) && port > 0 ? port : 22,
    user: first(computed.user),
    identityFiles: all(computed.identityfile).map((f) => expandHome(f, cfg.homeDir)),
    unsupported: [...UNSUPPORTED].filter(([k]) => computed[k] !== undefined).map(([, name]) => name),
  };
}

/** 列出可选的 Host（不含通配符模式） */
export function listHosts(cfg: ParsedSshConfig): SshHostInfo[] {
  const aliases = explicitAliases(cfg);
  return aliases.flatMap((alias) => {
    const h = resolveHost(cfg, alias);
    return h ? [{ alias, hostname: h.hostname, user: h.user, port: h.port, unsupported: h.unsupported }] : [];
  });
}
