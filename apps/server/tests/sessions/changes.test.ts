import { EventEmitter } from 'node:events';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionChanges, type SessionChangesWatch } from '../../src/sessions/changes';

const services: Array<{ dispose(): void }> = [];
async function removeTemporary(homeDir: string, temporaryRoot: string) {
  if (path.dirname(homeDir) !== temporaryRoot || !path.basename(homeDir).startsWith('agentdeck-session-watch-'))
    throw new Error('临时目录范围校验失败');
  await rm(homeDir, { recursive: true, force: true });
}
afterEach(() => {
  services.splice(0).forEach((service) => service.dispose());
  vi.useRealTimers();
});
function fixture() {
  vi.useFakeTimers();
  const homeDir = path.resolve('fixtures', 'native-home');
  const roots = {
    claude: path.join(homeDir, '.claude', 'projects'),
    codex: path.join(homeDir, '.codex'),
    antigravity: path.join(homeDir, '.gemini', 'antigravity-cli'),
  };
  const missing = new Set<string>();
  const active = new Set<ReturnType<typeof watcher>>();
  let attempts = 0;
  let peak = 0;
  function watcher(directory: string, recursive: boolean, listener: Parameters<SessionChangesWatch>[2]) {
    const result = Object.assign(new EventEmitter(), {
      directory,
      recursive,
      unref: vi.fn(),
      listener,
      close: vi.fn(() => {
        active.delete(result);
        result.emit('close');
      }),
    });
    return result;
  }
  const watch: SessionChangesWatch = (directory, options, listener) => {
    attempts++;
    if (missing.has(directory)) throw Object.assign(new Error('fixture'), { code: 'ENOENT' });
    const result = watcher(directory, options.recursive, listener);
    active.add(result);
    peak = Math.max(peak, active.size);
    return result;
  };
  return {
    homeDir,
    roots,
    active,
    missing,
    attempts: () => attempts,
    peak: () => peak,
    start(env: NodeJS.ProcessEnv = {}) {
      const service = createSessionChanges({ homeDir, env, watch });
      services.push(service);
      return service;
    },
    change(directory: string, filename: string | null, event: 'change' | 'rename' = 'change') {
      for (const item of [...active]) if (item.directory === directory) item.listener(event, filename);
    },
  };
}

it('只监听三个原生根，支持原生home覆盖，事件合并且无关配置不触发刷新', async () => {
  const f = fixture();
  const claudeRoot = path.join(f.homeDir, 'claude-custom');
  const codexRoot = path.join(f.homeDir, 'codex-custom');
  const service = f.start({ CLAUDE_CONFIG_DIR: claudeRoot, CODEX_HOME: codexRoot });
  expect(service.read()).toMatchObject({ revision: 0, watching: true });
  expect(
    [...f.active]
      .filter((item) => item.recursive)
      .map((item) => item.directory)
      .sort(),
  ).toEqual([path.join(claudeRoot, 'projects'), codexRoot].sort());
  f.change(codexRoot, 'config.toml');
  f.change(f.roots.antigravity, 'settings.json');
  await vi.advanceTimersByTimeAsync(1000);
  expect(service.read().revision).toBe(0);
  for (let index = 0; index < 1000; index++) f.change(codexRoot, 'sessions/2026/11/session.jsonl');
  f.change(path.join(claudeRoot, 'projects'), 'project/session.jsonl');
  f.change(f.roots.antigravity, 'conversation_summaries.db-wal');
  await vi.advanceTimersByTimeAsync(1000);
  expect(service.read().revision).toBe(1);
  expect(f.peak()).toBeLessThanOrEqual(6);
  expect(JSON.stringify(service.read())).not.toContain(f.homeDir);
});

it('缺失根只用父目录发现与30秒重试，恢复后重新监听并提示刷新', async () => {
  const f = fixture();
  f.missing.add(f.roots.claude);
  const service = f.start();
  expect(service.read()).toMatchObject({ watching: false, message: expect.stringContaining('Claude') });
  const count = f.attempts();
  await vi.advanceTimersByTimeAsync(29000);
  expect(f.attempts()).toBe(count);
  f.missing.delete(f.roots.claude);
  f.change(path.dirname(f.roots.claude), 'projects', 'rename');
  await vi.advanceTimersByTimeAsync(2000);
  expect(service.read().watching).toBe(true);
  expect(service.read().revision).toBe(1);
  expect(f.peak()).toBeLessThanOrEqual(6);
});

it('监听error后关闭失效watch，事件洪泛有界，dispose取消全部重试', async () => {
  const f = fixture();
  const service = f.start();
  const root = [...f.active].find((item) => item.directory === f.roots.codex)!;
  expect(root).toBeDefined();
  root.emit('error', new Error('private-path-value'));
  expect(service.read()).toMatchObject({ watching: false, message: expect.stringContaining('Codex') });
  expect(JSON.stringify(service.read())).not.toContain('private-path-value');
  expect(root.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30000);
  expect(service.read().watching).toBe(true);
  for (let index = 0; index < 50; index++) {
    f.change(f.roots.codex, 'state_5.sqlite-wal');
    await vi.advanceTimersByTimeAsync(50);
  }
  expect(service.read().revision).toBeGreaterThan(0);
  expect(service.read().revision).toBeLessThanOrEqual(4);
  service.dispose();
  const count = f.attempts();
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.active.size).toBe(0);
  expect(f.attempts()).toBe(count);
});

it('真实临时目录的原生文件变化可推进revision，读取接口不泄露路径或内容', async () => {
  const temporaryRoot = path.resolve(tmpdir());
  const homeDir = await mkdtemp(path.join(temporaryRoot, 'agentdeck-session-watch-'));
  let service: ReturnType<typeof createSessionChanges> | undefined;
  try {
    const project = path.join(homeDir, '.claude', 'projects', 'demo');
    await Promise.all([
      mkdir(project, { recursive: true }),
      mkdir(path.join(homeDir, '.codex')),
      mkdir(path.join(homeDir, '.gemini', 'antigravity-cli'), { recursive: true }),
    ]);
    service = createSessionChanges({ homeDir, env: {} });
    expect(service.read().watching).toBe(true);
    await writeFile(path.join(project, 'session.jsonl'), 'synthetic-session-body', 'utf8');
    await vi.waitFor(() => expect(service!.read().revision).toBeGreaterThan(0), { timeout: 4000, interval: 50 });
    const snapshot = JSON.stringify(service.read());
    expect(snapshot).not.toContain(homeDir);
    expect(snapshot).not.toContain('synthetic-session-body');
    service.dispose();
    expect(service.read().watching).toBe(false);
  } finally {
    service?.dispose();
    await removeTemporary(homeDir, temporaryRoot);
  }
});
