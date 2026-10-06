import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from '@ssh-server/shared';
import { runClaudeTurn } from '../../src/agents/claude-adapter';
import { createSessionRegistry } from '../../src/chat/registry';
import { TurnManager } from '../../src/chat/turn-manager';

// 防止旧的隐式回退在回归测试中启动真实运行时。
vi.mock('../../src/agents/claude-adapter', () => ({
  runClaudeTurn: vi.fn(() => ({ done: Promise.resolve(), interrupt: async () => undefined })),
}));

describe('显式Agent运行器注册表', () => {
  it('只注册Codex时Claude不可用，不能隐式启动Claude或改用Codex', async () => {
    const codex = vi.fn();
    const sync = { sync: vi.fn() };
    const socket = { send: vi.fn(), isOpen: () => true };
    const turns = new TurnManager({
      getWorkspace: async () => ({ id: 'w1' }) as Workspace,
      registry: createSessionRegistry(),
      internalUrl: () => 'http://127.0.0.1:1',
      runners: { codex },
      sessions: { assertBelongs: vi.fn() },
      sync,
    });
    await turns.handle(socket, {
      type: 'chat.send',
      agent: 'claude',
      workspaceId: 'w1',
      text: '你好',
      clientTurnId: 'c1',
    });
    expect(runClaudeTurn).not.toHaveBeenCalled();
    expect(codex).not.toHaveBeenCalled();
    expect(sync.sync).not.toHaveBeenCalled();
    expect(socket.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: '当前 Agent 适配器不可用' }),
    );
    await turns.dispose();
  });
});
