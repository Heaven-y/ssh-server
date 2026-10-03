import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from '@ssh-server/shared';
import type { NativeCapabilityCatalog } from '../../src/agents/capability-types';
import { createCapabilitiesService } from '../../src/chat/capabilities';

const ws: Workspace = {
  id: 'w',
  name: 'demo',
  localDir: path.join(tmpdir(), 'capabilities-fixture'),
  sshHost: 'my-server',
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
        invocation: { kind: 'skill', name: 'inspect', path: path.join(ws.localDir, 'SKILL.md') },
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
  it('目录只返回公开元数据；普通消息不扫描，选择仅解析为当前原生路径', async () => {
    const { service, provider } = setup();
    expect(await service.prepare(ws, 'codex', { text: '查看 /tmp/example.py' })).toEqual({
      text: '查看 /tmp/example.py',
    });
    expect(await service.prepare(ws, 'codex', { text: '/tmp/example.py' })).toEqual({ text: '/tmp/example.py' });
    expect(provider).not.toHaveBeenCalled();
    const result = await service.read(ws, 'codex');
    expect(result.entries[0]).not.toHaveProperty('invocation');
    const input = await service.prepare(ws, 'codex', { text: '', selection: { id: 'skill' } });
    expect(input).toEqual({
      text: '',
      invocation: { kind: 'skill', name: 'inspect', path: path.join(ws.localDir, 'SKILL.md') },
    });
    expect(provider).toHaveBeenCalledWith(ws.localDir, undefined);
  });

  it('拒绝过期、禁用、未知与有歧义的选择，不降级为模型文本', async () => {
    const { service, catalog } = setup();
    await expect(service.prepare(ws, 'codex', { text: '', selection: { id: 'stale' } })).rejects.toMatchObject({
      code: 'capability_missing',
    });
    await expect(service.prepare(ws, 'codex', { text: '/unknown' })).rejects.toMatchObject({
      code: 'capability_missing',
    });
    await expect(service.prepare(ws, 'codex', { text: '/terminal' })).rejects.toThrow('本机 CLI');
    catalog.entries.push({ ...catalog.entries[0]!, id: 'duplicate' });
    await expect(service.prepare(ws, 'codex', { text: '/inspect task' })).rejects.toMatchObject({
      code: 'capability_missing',
    });
    catalog.entries[0]!.available = false;
    await expect(service.prepare(ws, 'codex', { text: '', selection: { id: 'skill' } })).rejects.toMatchObject({
      code: 'capability_unavailable',
    });
  });

  it('按精确名再别名选择，并校验会话和参数约束', async () => {
    const { service, catalog } = setup();
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
    expect(await service.prepare(ws, 'claude', { text: '/shrink data' })).toEqual({
      text: 'data',
      invocation: { kind: 'skill', name: 'shrink' },
    });
  });

  it('取消和原生失败不泄露诊断或返回可执行选择', async () => {
    const { service, provider } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(service.read(ws, 'claude', controller.signal)).rejects.toMatchObject({
      code: 'capabilities_unavailable',
    });
    expect(provider).not.toHaveBeenCalled();
    provider.mockRejectedValueOnce(new Error('private-config-sentinel'));
    await expect(service.read(ws, 'codex')).rejects.toMatchObject({
      message: 'Codex 能力读取失败，请检查本机运行时与配置',
    });
  });
});
