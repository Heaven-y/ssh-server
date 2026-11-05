import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from '@agentdeck/shared';
import type { NativeCapabilityCatalog } from '../../src/agents/capability-types';
import { createCapabilitiesService } from '../../src/chat/capabilities';

const ws: Workspace = {
  id: 'w',
  name: 'demo',
  dir: path.join(tmpdir(), 'capabilities-fixture'),
  server: 'my-server',
  remoteDir: '~/projects/demo',
};
function setup() {
  const catalog: NativeCapabilityCatalog = {
    models: [{ id: 'native-model', label: '原生候选' }],
    warnings: [],
    entries: [
      {
        id: 'skill',
        kind: 'skill',
        name: 'inspect',
        description: '项目技能',
        available: true,
        requiresSession: false,
        supportsArguments: true,
        invocation: { kind: 'skill', name: 'inspect', path: path.join(ws.dir, 'SKILL.md') },
      },
      {
        id: 'compact',
        kind: 'command',
        name: 'compact',
        aliases: ['shrink'],
        description: '压缩',
        available: true,
        requiresSession: true,
        supportsArguments: false,
        invocation: { kind: 'command', name: 'compact' },
      },
      {
        id: 'terminal',
        kind: 'command',
        name: 'terminal',
        description: '终端命令',
        available: false,
        unavailableReason: '请使用本机 CLI',
        requiresSession: false,
        supportsArguments: false,
      },
    ],
  };
  const provider = vi.fn(async () => catalog);
  return { catalog, provider, service: createCapabilitiesService({ claude: provider, codex: provider }) };
}

describe('原生能力解析', () => {
  it('配置保存同时清除旧缓存与在途刷新，其他 CLI 缓存保留', async () => {
    const { service, provider, catalog } = setup();
    await service.refresh(ws, 'claude');
    await service.refresh(ws, 'codex');
    let finish!: (value: NativeCapabilityCatalog) => void;
    provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = service.refresh(ws, 'codex');
    service.invalidate('codex');
    finish(catalog);
    await expect(pending).rejects.toMatchObject({ code: 'capabilities_refresh_superseded' });
    expect((await service.read(ws, 'codex')).discovered).toBe(false);
    expect((await service.read(ws, 'claude')).discovered).toBe(true);
    await service.refresh(ws, 'codex');
    expect((await service.read(ws, 'codex')).discovered).toBe(true);
  });
  it('目录只返回公开元数据；普通消息不扫描，选择仅解析为当前原生路径', async () => {
    const { service, provider } = setup();
    expect(await service.prepare(ws, 'codex', { text: '查看 /tmp/example.py' })).toEqual({
      text: '查看 /tmp/example.py',
    });
    expect(await service.prepare(ws, 'codex', { text: '/tmp/example.py' })).toEqual({ text: '/tmp/example.py' });
    expect(provider).not.toHaveBeenCalled();
    const empty = await service.read(ws, 'codex');
    expect(empty.entries).toEqual([]);
    expect(empty.models).toEqual([]);
    expect(empty.discovered).toBe(false);
    expect(empty.warnings.join('')).toContain('刷新');
    expect(provider).not.toHaveBeenCalled();
    await expect(service.prepare(ws, 'codex', { text: '/inspect' })).rejects.toMatchObject({
      code: 'capabilities_not_refreshed',
    });
    expect(provider).not.toHaveBeenCalled();
    const result = await service.refresh(ws, 'codex');
    expect(result.discovered).toBe(true);
    expect(result.entries[0]).not.toHaveProperty('invocation');
    const input = await service.prepare(ws, 'codex', { text: '', selection: { id: 'skill' } });
    expect(input).toEqual({
      text: '',
      invocation: { kind: 'skill', name: 'inspect', path: path.join(ws.dir, 'SKILL.md') },
    });
    expect(provider).toHaveBeenCalledWith(ws.dir, undefined);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('拒绝过期、禁用、未知与有歧义的选择，不降级为模型文本', async () => {
    const { service, catalog } = setup();
    await service.refresh(ws, 'codex');
    await expect(service.prepare(ws, 'codex', { text: '', selection: { id: 'stale' } })).rejects.toMatchObject({
      code: 'capability_missing',
    });
    await expect(service.prepare(ws, 'codex', { text: '/unknown' })).rejects.toMatchObject({
      code: 'capability_missing',
    });
    await expect(service.prepare(ws, 'codex', { text: '/terminal' })).rejects.toThrow('本机 CLI');
    catalog.entries.push({ ...catalog.entries[0]!, id: 'duplicate' });
    await service.refresh(ws, 'codex');
    await expect(service.prepare(ws, 'codex', { text: '/inspect task' })).rejects.toMatchObject({
      code: 'capability_missing',
    });
    catalog.entries[0]!.available = false;
    await service.refresh(ws, 'codex');
    await expect(service.prepare(ws, 'codex', { text: '', selection: { id: 'skill' } })).rejects.toMatchObject({
      code: 'capability_unavailable',
    });
  });

  it('按精确名再别名选择，并校验会话和参数约束', async () => {
    const { service, catalog } = setup();
    await service.refresh(ws, 'claude');
    await service.refresh(ws, 'codex');
    await expect(service.prepare(ws, 'claude', { text: '/shrink' })).rejects.toMatchObject({
      code: 'session_required',
    });
    await expect(service.prepare(ws, 'codex', { text: '/compact extra', sessionId: 'native' })).rejects.toMatchObject({
      code: 'arguments_unsupported',
    });
    expect(await service.prepare(ws, 'codex', { text: '/shrink', sessionId: 'native' })).toEqual({
      text: '',
      invocation: { kind: 'command', name: 'compact' },
    });
    catalog.entries.push({
      ...catalog.entries[0]!,
      id: 'exact',
      name: 'shrink',
      invocation: { kind: 'skill', name: 'shrink' },
    });
    await service.refresh(ws, 'claude');
    expect(await service.prepare(ws, 'claude', { text: '/shrink data' })).toEqual({
      text: 'data',
      invocation: { kind: 'skill', name: 'shrink' },
    });
  });

  it('取消和原生失败不泄露诊断或返回可执行选择', async () => {
    const { service, provider } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(service.refresh(ws, 'claude', controller.signal)).rejects.toMatchObject({
      code: 'capabilities_unavailable',
    });
    expect(provider).not.toHaveBeenCalled();
    provider.mockRejectedValueOnce(new Error('private-config-sentinel'));
    await expect(service.refresh(ws, 'codex')).rejects.toMatchObject({
      message: 'Codex 能力读取失败，请检查本机运行时与配置',
    });
  });

  it('尚未接入适配器的 CLI 报 503 并说明缺什么，不伪装成空目录', async () => {
    const { service } = setup();
    // antigravity 已在协议里，但还没有 provider；界面据此显示"不可用"而不是空清单
    expect((await service.read(ws, 'antigravity')).entries).toEqual([]);
    await expect(service.refresh(ws, 'antigravity')).rejects.toMatchObject({
      status: 503,
      code: 'agent_unavailable',
      message: 'Antigravity 适配器尚未接入',
    });
    // 普通正文不探测能力，因此不会被这条 503 挡住；只有要解析能力时才需要适配器
    expect(await service.prepare(ws, 'antigravity', { text: '你好' })).toEqual({ text: '你好' });
    await expect(service.prepare(ws, 'antigravity', { text: '/help' })).rejects.toMatchObject({
      code: 'capabilities_not_refreshed',
    });
  });

  it('刷新失败或取消不覆盖成功缓存，目录和 CLI 变化时不复用', async () => {
    const { service, provider } = setup();
    const good = await service.refresh(ws, 'claude');
    provider.mockRejectedValueOnce(new Error('private-config-sentinel'));
    await expect(service.refresh(ws, 'claude')).rejects.toMatchObject({ code: 'capabilities_unavailable' });
    expect(await service.read(ws, 'claude')).toEqual(good);
    const controller = new AbortController();
    controller.abort();
    await expect(service.refresh(ws, 'claude', controller.signal)).rejects.toMatchObject({
      code: 'capabilities_unavailable',
    });
    expect(await service.read(ws, 'claude')).toEqual(good);
    expect((await service.read({ ...ws, dir: path.join(ws.dir, 'other') }, 'claude')).entries).toEqual([]);
    expect((await service.read(ws, 'codex')).entries).toEqual([]);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('并发刷新只保留最后发起的一次，迟到结果和调用方修改不污染缓存', async () => {
    const { service, provider, catalog } = setup();
    let finishFirst!: (result: NativeCapabilityCatalog) => void;
    provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const first = service.refresh(ws, 'codex');
    const latest = await service.refresh(ws, 'codex');
    finishFirst({ ...catalog, models: [{ id: 'older', label: '旧结果' }] });
    await expect(first).rejects.toMatchObject({ code: 'capabilities_refresh_superseded' });
    expect(await service.read(ws, 'codex')).toEqual(latest);
    latest.models[0]!.id = 'caller-change';
    catalog.entries[0]!.invocation = { kind: 'skill', name: 'wrong' };
    expect((await service.read(ws, 'codex')).models[0]!.id).toBe('native-model');
    expect(await service.prepare(ws, 'codex', { text: '/inspect' })).toMatchObject({
      invocation: { kind: 'skill', name: 'inspect' },
    });
  });
});
