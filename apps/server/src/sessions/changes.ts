import type { SessionChangesSnapshot } from '@agentdeck/shared';
import { watch as nativeWatch } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

type SessionChangesWatcher = {
  on(event: 'error' | 'close', listener: () => void): void;
  close(): void;
  unref(): void;
};
export type SessionChangesWatch = (
  directory: string,
  options: { recursive: boolean },
  listener: (event: 'rename' | 'change', filename: string | Buffer | null) => void,
) => SessionChangesWatcher;
export type SessionChangesOptions = { homeDir?: string; env?: NodeJS.ProcessEnv; watch?: SessionChangesWatch };
export type SessionChangesService = { read(): SessionChangesSnapshot; dispose(): void };

type Watcher = ReturnType<SessionChangesWatch>;
type Source = {
  name: string;
  root: string;
  recursive: boolean;
  matches(filename: string): boolean;
  primary?: Watcher;
  parent?: Watcher;
  parentPath?: string;
  reconcile?: NodeJS.Timeout;
};
const RETRY_MS = 30_000;
const DEBOUNCE_MS = 1000;
const MAX_PARENT_LEVELS = 8;

function sourcesFor(options: SessionChangesOptions): Source[] {
  const homeDir = path.resolve(options.homeDir ?? homedir());
  const env = options.env ?? process.env;
  return [
    {
      name: 'Claude',
      root: path.join(path.resolve(env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude')), 'projects'),
      recursive: true,
      matches: (filename) =>
        !filename.split('/').includes('memory') &&
        (/\.jsonl$|sessions-index\.json$/.test(filename) || !path.posix.extname(filename)),
    },
    {
      // 会话提供者通过原生 app-server 读列表；这里只监视其标准存储根，绝不读取或重建正文。
      name: 'Codex',
      root: path.resolve(env.CODEX_HOME || path.join(homeDir, '.codex')),
      recursive: true,
      matches: (filename) =>
        /^(sessions|archived_sessions)(\/|$)/.test(filename) ||
        /^(session_index\.jsonl|state_\d+\.sqlite(?:-wal|-shm)?)$/.test(filename),
    },
    {
      // 与 agents/antigravity/sessions.ts 的摘要库位置一致；WAL/SHM 也会影响原生列表。
      name: 'Antigravity',
      root: path.join(homeDir, '.gemini', 'antigravity-cli'),
      recursive: false,
      matches: (filename) => /^conversation_summaries\.db(?:-wal|-shm|-journal)?$/.test(filename),
    },
  ];
}
function normalizedName(filename: string | Buffer | null): string | undefined {
  if (filename === null) return;
  return (Buffer.isBuffer(filename) ? filename.toString('utf8') : filename).replaceAll('\\', '/');
}

/** 固定三主监听和三父目录哨兵；只消费文件名事件，不遍历目录、不读取会话或配置正文。 */
export function createSessionChanges(options: SessionChangesOptions = {}): SessionChangesService {
  const watch: SessionChangesWatch =
    options.watch ??
    ((directory, config, listener) => nativeWatch(directory, { ...config, encoding: 'utf8' }, listener));
  const sources = sourcesFor(options);
  let revision = 0;
  let disposed = false;
  let initialized = false;
  let pending: NodeJS.Timeout | undefined;
  function changed() {
    if (disposed || pending) return;
    // 不反复向后推迟：持续写入也最多每秒发布一次，避免事件洪泛或永远不刷新。
    pending = setTimeout(() => {
      pending = undefined;
      if (!disposed) revision++;
    }, DEBOUNCE_MS);
    pending.unref();
  }
  function close(source: Source, kind: 'primary' | 'parent') {
    const current = source[kind];
    source[kind] = undefined;
    if (kind === 'parent') source.parentPath = undefined;
    current?.close();
  }
  function attach(
    source: Source,
    kind: 'primary' | 'parent',
    directory: string,
    listener: Parameters<SessionChangesWatch>[2],
  ): boolean {
    try {
      const watcher = watch(directory, { recursive: kind === 'primary' && source.recursive }, listener);
      source[kind] = watcher;
      if (kind === 'parent') source.parentPath = directory;
      const lost = () => {
        if (source[kind] !== watcher) return;
        close(source, kind);
        if (!disposed && initialized) changed();
      };
      watcher.on('error', lost);
      watcher.on('close', lost);
      watcher.unref();
      return true;
    } catch {
      return false;
    }
  }
  function reopenSoon(source: Source) {
    if (disposed || source.reconcile) return;
    source.reconcile = setTimeout(() => {
      source.reconcile = undefined;
      if (disposed) return;
      close(source, 'primary');
      close(source, 'parent');
      setup(source);
      changed();
    }, DEBOUNCE_MS);
    source.reconcile.unref();
  }
  function openPrimary(source: Source) {
    if (source.primary) return;
    const attached = attach(source, 'primary', source.root, (event, filename) => {
      if (disposed || !source.primary) return;
      const name = normalizedName(filename);
      if (name === undefined || source.matches(name)) changed();
      if (event === 'rename' && name === undefined) reopenSoon(source);
    });
    if (attached && initialized) changed();
  }
  function openParent(source: Source) {
    if (source.parent) return;
    let directory = path.dirname(source.root);
    for (let depth = 0; depth < MAX_PARENT_LEVELS; depth++) {
      const child = path.relative(directory, source.root).split(path.sep)[0];
      if (!child) return;
      if (
        attach(source, 'parent', directory, (_event, filename) => {
          const name = normalizedName(filename);
          if (name === undefined || name === child) reopenSoon(source);
        })
      )
        return;
      const parent = path.dirname(directory);
      if (parent === directory) return;
      directory = parent;
    }
  }
  function setup(source: Source) {
    openPrimary(source);
    openParent(source);
  }
  for (const source of sources) setup(source);
  initialized = true;
  const retry = setInterval(() => {
    if (!disposed) for (const source of sources) setup(source);
  }, RETRY_MS);
  retry.unref();
  return {
    read() {
      const unavailable = sources.filter((source) => !source.primary).map((source) => source.name);
      const missingParent = sources.filter((source) => !source.parent).map((source) => source.name);
      let message: string | undefined;
      if (disposed) message = '会话目录监听已停止，可以手动刷新列表。';
      else if (unavailable.length)
        message = `${unavailable.join('、')} 会话目录尚未就绪或监听不可用，每 30 秒重试；仍可手动刷新。`;
      else if (missingParent.length)
        message = `${missingParent.join('、')} 父目录监听不可用，每 30 秒重试；目录被替换时请手动刷新。`;
      return { revision, watching: !disposed && unavailable.length === 0, ...(message ? { message } : {}) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(retry);
      clearTimeout(pending);
      for (const source of sources) {
        clearTimeout(source.reconcile);
        close(source, 'primary');
        close(source, 'parent');
      }
    },
  };
}
