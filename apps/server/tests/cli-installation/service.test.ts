import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentKind } from '@agentdeck/shared/conversation';
import { SessionError } from '../../src/agents/errors';
import { createCliInstallationService, type CliInstallationService } from '../../src/cli-installation/service';
import type { CliInstallation, CliInstallationBackend } from '../../src/cli-installation/types';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function installation(agent: AgentKind = 'claude'): CliInstallation {
  return {
    agent,
    installed: true,
    version: '1.0.0',
    source: 'npm',
    identity: `${agent}-initial`,
    command: { command: process.execPath, args: [path.join('fixture', `${agent}.js`)] },
    prefix: path.join('fixture', 'prefix'),
    canInstall: false,
    canUpdate: true,
    message: null,
    guideUrl: 'https://example.com/guide',
  };
}

const services: CliInstallationService[] = [];
function fixture() {
  const values = new Map<AgentKind, CliInstallation>([
    ['claude', installation()],
    ['codex', installation('codex')],
  ]);
  const execute = vi.fn<CliInstallationBackend['execute']>(async () => undefined);
  const inspect = vi.fn<CliInstallationBackend['inspect']>(async (agent) => ({ ...values.get(agent)! }));
  const latest = vi.fn<CliInstallationBackend['latest']>(async () => ({ version: '2.0.0' }));
  const onChanged = vi.fn(async () => undefined);
  const restart = vi.fn(async () => undefined);
  const verify = vi.fn(async () => true);
  const lock = vi.fn(async <T>(_agent: AgentKind, operation: () => Promise<T>) => operation());
  let time = 1_000;
  const service = createCliInstallationService({
    backend: { inspect, latest, execute },
    withIdleAgent: <T>(agent: AgentKind, operation: () => Promise<T>) => lock(agent, operation) as Promise<T>,
    onChanged,
    restart,
    verify,
    now: () => time,
  });
  services.push(service);
  return {
    service,
    values,
    inspect,
    latest,
    execute,
    onChanged,
    restart,
    verify,
    lock,
    advance: () => (time += 900_001),
  };
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
});

describe('CLI 安装后台任务', () => {
  it('读取只检查本机；显式查新合并并发且失败保留已知安装', async () => {
    const f = fixture();
    const read = await f.service.read('claude');
    expect(read).toMatchObject({ currentVersion: '1.0.0', latestVersion: null, checkedAt: null, canUpdate: false });
    expect(f.latest).not.toHaveBeenCalled();
    const release = deferred<{ version: string }>();
    f.latest.mockReturnValue(release.promise);
    const first = f.service.check('claude');
    const second = f.service.check('claude');
    release.resolve({ version: '2.0.0' });
    expect(await first).toMatchObject({ latestVersion: '2.0.0', checkedAt: 1_000, canUpdate: true });
    await second;
    expect(f.latest).toHaveBeenCalledTimes(1);
    f.latest.mockRejectedValue(new Error('private-token'));
    const failed = await f.service.check('claude');
    expect(failed).toMatchObject({ installed: true, currentVersion: '1.0.0', phase: 'failed', canUpdate: false });
    expect(failed.message).not.toContain('private-token');
    expect(failed.latestVersion).toBeNull();
    expect(await f.service.read('claude')).toMatchObject({ phase: 'failed', latestVersion: null, checkedAt: null });
  });

  it('忙会话不产生假任务；取得锁之后才接受任务', async () => {
    const f = fixture();
    const checked = await f.service.check('claude');
    f.lock.mockRejectedValueOnce(new SessionError(409, 'agent_busy', 'private-session'));
    await expect(f.service.start('claude', { action: 'update', revision: checked.revision })).rejects.toMatchObject({
      code: 'agent_busy',
      status: 409,
    });
    expect(await f.service.read('claude')).toMatchObject({ phase: 'idle', operationId: null });
    expect(f.execute).not.toHaveBeenCalled();
    const acquired = deferred();
    f.lock.mockImplementationOnce(async (_agent, operation) => {
      await acquired.promise;
      return operation();
    });
    const execution = deferred();
    f.execute.mockReturnValueOnce(execution.promise);
    let accepted = false;
    const starting = f.service.start('claude', { action: 'update', revision: checked.revision }).then((status) => {
      accepted = true;
      return status;
    });
    await Promise.resolve();
    expect(accepted).toBe(false);
    acquired.resolve();
    expect(await starting).toMatchObject({ phase: 'updating' });
    execution.resolve();
  });

  it('单宿主互斥；关闭后重读恢复同一任务，执行中不重复探测版本', async () => {
    const f = fixture();
    const checked = await f.service.check('claude');
    const codex = await f.service.check('codex');
    const execution = deferred();
    f.execute.mockReturnValueOnce(execution.promise);
    const started = await f.service.start('claude', { action: 'update', revision: checked.revision });
    expect(started.operationId).toEqual(expect.any(String));
    const probes = f.inspect.mock.calls.length;
    expect(await f.service.read('claude')).toMatchObject({ operationId: started.operationId, phase: 'updating' });
    expect(f.inspect).toHaveBeenCalledTimes(probes);
    for (const [agent, revision] of [
      ['claude', checked.revision],
      ['codex', codex.revision],
    ] as const) {
      await expect(f.service.start(agent, { action: 'update', revision })).rejects.toMatchObject({
        code: 'installation_busy',
      });
    }
    f.values.set('claude', { ...installation(), identity: 'updated', version: '2.1.0' });
    execution.resolve();
    await vi.waitFor(async () =>
      expect(await f.service.read('claude')).toMatchObject({
        phase: 'succeeded',
        currentVersion: '2.1.0',
        operationId: started.operationId,
      }),
    );
    expect(f.onChanged).toHaveBeenCalledExactlyOnceWith('claude');
    expect(f.restart).toHaveBeenCalledExactlyOnceWith('claude');
    f.latest.mockRejectedValueOnce(new Error('fixture-network'));
    expect(await f.service.check('claude')).toMatchObject({ phase: 'failed', operationId: null });
    expect(f.onChanged).toHaveBeenCalledTimes(1);
  });

  it('执行前拒绝变更的安装快照与过期版本检查', async () => {
    const f = fixture();
    const checked = await f.service.check('claude');
    f.values.set('claude', { ...installation(), identity: 'changed-outside' });
    await expect(f.service.start('claude', { action: 'update', revision: checked.revision })).rejects.toMatchObject({
      code: 'revision_conflict',
    });
    const refreshed = await f.service.check('claude');
    f.advance();
    await expect(f.service.start('claude', { action: 'update', revision: refreshed.revision })).rejects.toMatchObject({
      code: 'check_required',
    });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('查新过程中身份改变时不发布成功的版本检查', async () => {
    const f = fixture();
    const release = deferred<{ version: string }>();
    f.latest.mockReturnValueOnce(release.promise);
    const checking = f.service.check('claude');
    await vi.waitFor(() => expect(f.latest).toHaveBeenCalledTimes(1));
    f.values.set('claude', { ...installation(), identity: 'changed-during-check' });
    release.resolve({ version: '2.0.0' });
    expect(await checking).toMatchObject({ phase: 'failed', latestVersion: null, checkedAt: null, canUpdate: false });
  });

  it.each(['unchanged', 'entry-changed', 'incompatible'] as const)('退出码为零仍验证真实安装：%s', async (outcome) => {
    const f = fixture();
    f.execute.mockImplementationOnce(async () => {
      if (outcome === 'unchanged') return;
      const next = { ...installation(), version: '2.0.0', identity: 'updated' };
      if (outcome === 'entry-changed') next.command = { command: 'different-cli', args: [] };
      f.values.set('claude', next);
    });
    f.verify.mockResolvedValue(outcome !== 'incompatible');
    const checked = await f.service.check('claude');
    await f.service.start('claude', { action: 'update', revision: checked.revision });
    await vi.waitFor(async () => expect(await f.service.read('claude')).toMatchObject({ phase: 'failed' }));
    expect(f.onChanged).toHaveBeenCalledExactlyOnceWith('claude');
  });

  it('安装部分失败仍失效缓存、刷新本机状态且隐藏内部错误', async () => {
    const f = fixture();
    f.execute.mockImplementationOnce(async () => {
      f.values.set('claude', { ...installation(), identity: 'partial', version: '1.1.0' });
      throw new Error('private-token-and-path');
    });
    const checked = await f.service.check('claude');
    await f.service.start('claude', { action: 'update', revision: checked.revision });
    await vi.waitFor(async () =>
      expect(await f.service.read('claude')).toMatchObject({ phase: 'failed', currentVersion: '1.1.0' }),
    );
    expect((await f.service.read('claude')).message).not.toContain('private-token');
    expect(f.onChanged).toHaveBeenCalledExactlyOnceWith('claude');
  });

  it('关闭服务中止并等待安装收尾，拒绝之后的新任务', async () => {
    const f = fixture();
    const cleanup = deferred();
    f.execute.mockImplementationOnce(async (_installation, _version, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      await cleanup.promise;
      throw new Error('cancelled');
    });
    const checked = await f.service.check('claude');
    await f.service.start('claude', { action: 'update', revision: checked.revision });
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1));
    let closed = false;
    const closing = f.service.dispose().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    cleanup.resolve();
    await closing;
    expect(f.onChanged).toHaveBeenCalledExactlyOnceWith('claude');
    await expect(f.service.check('claude')).rejects.toMatchObject({ code: 'service_closed' });
  });

  it('首次安装必须产生可用版本，版本未知的既有安装仍可谨慎更新', async () => {
    const f = fixture();
    f.values.set('claude', {
      ...installation(),
      installed: false,
      version: null,
      source: 'missing',
      canInstall: true,
      canUpdate: false,
    });
    f.execute.mockImplementationOnce(async () => {
      f.values.set('claude', { ...installation(), version: '2.0.0' });
    });
    const initial = await f.service.read('claude');
    expect(initial).toMatchObject({ canInstall: true, latestVersion: null, checkedAt: null });
    await expect(f.service.start('claude', { action: 'install', revision: initial.revision })).rejects.toMatchObject({
      code: 'check_required',
    });
    expect(f.execute).not.toHaveBeenCalled();
    const missing = await f.service.check('claude');
    expect(missing).toMatchObject({ canInstall: true, canUpdate: false });
    await f.service.start('claude', { action: 'install', revision: missing.revision });
    await vi.waitFor(async () =>
      expect(await f.service.read('claude')).toMatchObject({
        installed: true,
        phase: 'succeeded',
        currentVersion: '2.0.0',
      }),
    );
    f.values.set('codex', { ...installation('codex'), version: null });
    f.execute.mockImplementationOnce(async () => {
      f.values.set('codex', { ...installation('codex'), version: '2.0.0' });
    });
    const unknown = await f.service.check('codex');
    expect(unknown.canUpdate).toBe(true);
    await f.service.start('codex', { action: 'update', revision: unknown.revision });
    await vi.waitFor(async () => expect(await f.service.read('codex')).toMatchObject({ phase: 'succeeded' }));
  });

  it('首次安装落入其他 npm prefix 时不报告成功', async () => {
    const f = fixture();
    f.values.set('claude', {
      ...installation(),
      installed: false,
      version: null,
      source: 'missing',
      canInstall: true,
      canUpdate: false,
    });
    f.execute.mockImplementationOnce(async () => {
      f.values.set('claude', { ...installation(), version: '2.0.0', prefix: path.join('fixture', 'other-prefix') });
    });
    const checked = await f.service.check('claude');
    await f.service.start('claude', { action: 'install', revision: checked.revision });
    await vi.waitFor(async () => expect(await f.service.read('claude')).toMatchObject({ phase: 'failed' }));
    expect(f.onChanged).toHaveBeenCalledExactlyOnceWith('claude');
  });

  it('比当前更旧的版本不开放更新，预发布版本正确判断先后', async () => {
    const f = fixture();
    f.values.set('claude', { ...installation(), version: '2.0.0' });
    f.latest.mockResolvedValueOnce({ version: '2.0.0-rc.1' });
    const older = await f.service.check('claude');
    expect(older).toMatchObject({ updateAvailable: false, canUpdate: false });
    await expect(f.service.start('claude', { action: 'update', revision: older.revision })).rejects.toMatchObject({
      code: 'check_required',
    });
    f.values.set('claude', { ...installation(), version: '2.0.0-rc.2' });
    f.latest.mockResolvedValueOnce({ version: '2.0.0-rc.10' });
    expect(await f.service.check('claude')).toMatchObject({ updateAvailable: true, canUpdate: true });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('关闭服务也中止进行中的版本检查，不将取消误报为检查成功', async () => {
    const f = fixture();
    await f.service.read('claude');
    f.latest.mockImplementationOnce(async (_installation, signal) => {
      await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('private-network-error');
    });
    const checking = f.service.check('claude');
    await vi.waitFor(() => expect(f.latest).toHaveBeenCalledTimes(1));
    await f.service.dispose();
    expect(await checking).toMatchObject({ phase: 'failed', installed: true, checkedAt: null, latestVersion: null });
  });

  it('取得空闲锁时同步异常也安全返回，并释放宿主安装占用', async () => {
    const f = fixture();
    const checked = await f.service.check('claude');
    f.lock.mockImplementationOnce(() => {
      throw new Error('private-lock-error');
    });
    await expect(f.service.start('claude', { action: 'update', revision: checked.revision })).rejects.toMatchObject({
      code: 'install_failed',
    });
    f.execute.mockImplementationOnce(async () => {
      f.values.set('claude', { ...installation(), version: '2.0.0' });
    });
    await expect(f.service.start('claude', { action: 'update', revision: checked.revision })).resolves.toMatchObject({
      phase: 'updating',
    });
  });
});
