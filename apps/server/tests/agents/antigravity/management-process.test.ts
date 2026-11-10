import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { startManagementBackend } from '../../../src/agents/antigravity/management-process';
import { createAntigravitySessionManagement } from '../../../src/agents/antigravity/management';
import { NativeTrajectoryMissing } from '../../../src/agents/antigravity/management-rpc';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function options(mode = '') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-agy-process-'));
  directories.push(root);
  const evidence = path.join(root, 'process.json');
  return {
    evidence,
    settings: {
      cwd: root,
      geminiDir: path.join(root, 'gemini'),
      env: { ...process.env, AGY_FIXTURE_MODE: mode, AGY_FIXTURE_EVIDENCE: evidence },
      command: {
        command: process.execPath,
        args: ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./fake-management.ts', import.meta.url))],
      },
    },
  };
}
async function stopped(file: string) {
  const value = JSON.parse(await readFile(file, 'utf8')) as { pid: number; port: number };
  expect(() => process.kill(value.pid, 0)).toThrow();
  await expect(fetch(`http://127.0.0.1:${value.port}`)).rejects.toThrow();
}

it('只取自有PID的HTTP端口，认证缺失不阻止本机管理，关闭确认后端也退出', async () => {
  const f = await options();
  const backend = await startManagementBackend(f.settings);
  if (process.platform === 'win32') expect(JSON.parse(await readFile(f.evidence, 'utf8')).updateDisabled).toBe('true');
  expect(await backend.request('GetCascadeTrajectory', { cascadeId: 'fixture' })).toEqual({ fixture: true });
  await backend.close();
  await stopped(f.evidence);
});

it('异常协议即关闭，不将已打印的端口交给调用方', async () => {
  const f = await options('malformed');
  await expect(startManagementBackend(f.settings)).rejects.toMatchObject({ code: 'session_runtime_failed' });
  await stopped(f.evidence);
});

it.each(['wait', 'foreign-pid'])('启动等待可取消，不连接其他PID的服务：%s', async (mode) => {
  const f = await options(mode);
  const controller = new AbortController();
  const pending = startManagementBackend({ ...f.settings, signal: controller.signal });
  const rejection = expect(pending).rejects.toMatchObject({ code: 'session_runtime_failed' });
  await vi.waitFor(async () => expect(await readFile(f.evidence, 'utf8')).toContain('pid'));
  controller.abort();
  await rejection;
  await stopped(f.evidence);
});

it('历史读取在后端初始化期间取消会结束进程，不等待初始化超时或读取轨迹', async () => {
  const f = await options('wait');
  const controller = new AbortController();
  const cleanup = new AbortController();
  const requested = vi.fn();
  const service = createAntigravitySessionManagement({
    backend: async (_dir: string, signal?: AbortSignal) => {
      const backend = await startManagementBackend({ ...f.settings, signal: signal ?? cleanup.signal });
      return {
        ...backend,
        request: (...args: Parameters<typeof backend.request>) => {
          requested();
          return backend.request(...args);
        },
      };
    },
  });
  let settled = false;
  const pending = service.readTrajectory!('fixture', f.settings.cwd, controller.signal).catch(() => {
    settled = true;
  });
  try {
    await vi.waitFor(async () => expect(await readFile(f.evidence, 'utf8')).toContain('pid'));
    controller.abort();
    await vi.waitFor(() => expect(settled).toBe(true));
    expect(requested).not.toHaveBeenCalled();
    await stopped(f.evidence);
  } finally {
    cleanup.abort();
    await service.dispose();
    await pending;
  }
});

it('关闭会中断等待中的HTTP请求，不泄漏后台服务', async () => {
  const f = await options('rpc-hang');
  const backend = await startManagementBackend(f.settings);
  const pending = backend.request('GetCascadeTrajectory', { cascadeId: 'fixture' });
  const rejection = expect(pending).rejects.toMatchObject({ code: 'session_runtime_failed' });
  await backend.close();
  await rejection;
  await stopped(f.evidence);
});

it.each(['rpc-missing', 'rpc-unknown'])('只有原生轨迹不存在才允许删除补清理：%s', async (mode) => {
  const f = await options(mode);
  const backend = await startManagementBackend(f.settings);
  try {
    const error = await backend
      .request('GetCascadeTrajectory', { cascadeId: 'fixture' })
      .catch((reason: unknown) => reason);
    expect(error instanceof NativeTrajectoryMissing).toBe(mode === 'rpc-missing');
    expect(JSON.stringify(error)).not.toContain('fixture-private');
    const methodError = await backend
      .request('DeleteCascadeTrajectory', { cascadeId: 'fixture' })
      .catch((reason: unknown) => reason);
    expect(methodError).not.toBeInstanceOf(NativeTrajectoryMissing);
  } finally {
    await backend.close();
  }
});
