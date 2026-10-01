import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@ssh-server/shared';
import type { ConnectionStatus } from '../../lib/ws';

// node 环境没有 localStorage，用内存实现
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
});

const { useChat, startChatConnection, lastWorkspaceId } = await import('./chat-store');

/** 假连接：记录发出的消息，测试通过 emit / status 模拟后端 */
const sent: ClientMessage[] = [];
let open = true;
let emit: (m: ServerMessage) => void = () => undefined;
let status: (s: ConnectionStatus) => void = () => undefined;

beforeAll(() => {
  startChatConnection((h) => {
    emit = h.onMessage;
    status = h.onStatus;
    return {
      send: (m) => (open ? (sent.push(m), true) : false),
      reconnect: () => undefined,
      close: () => undefined,
    };
  });
});

beforeEach(() => {
  sent.length = 0;
  open = true;
  useChat.setState({ workspaceId: undefined, connection: 'open', model: '' });
  useChat.getState().selectWorkspace('w1');
});

/** 发送一条消息并让后端确认开始，返回 turnId */
function startTurn(text = '你好'): string {
  useChat.getState().send(text);
  const msg = sent.at(-1) as Extract<ClientMessage, { type: 'chat.send' }>;
  emit({ type: 'turn.started', turnId: 't1', clientTurnId: msg.clientTurnId });
  return 't1';
}

describe('chat-store', () => {
  it('选择工作区时记住它，并清空当前会话', () => {
    expect(lastWorkspaceId()).toBe('w1');
    expect(useChat.getState()).toMatchObject({ workspaceId: 'w1', items: [], running: false });
  });

  it('发送：模型留空时不传 model，用户消息立即显示', () => {
    useChat.getState().send('你好');
    expect(sent[0]).toMatchObject({ type: 'chat.send', workspaceId: 'w1', text: '你好', model: undefined });
    expect(useChat.getState()).toMatchObject({ running: true, items: [{ kind: 'user', text: '你好' }] });
  });

  it('填写模型时随消息发送', () => {
    useChat.getState().setModel('  opus  ');
    useChat.getState().send('x');
    expect(sent[0]).toMatchObject({ model: 'opus' });
  });

  it('运行中不能再次发送；断开时提示未发送', () => {
    startTurn();
    useChat.getState().send('再来');
    expect(sent).toHaveLength(1);

    useChat.setState({ running: false });
    open = false;
    useChat.getState().send('断开时');
    expect(useChat.getState().banner).toContain('未发送');
  });

  it('只接收当前轮的事件；session 事件更新会话与模型；结束后停止运行', () => {
    const turnId = startTurn();
    emit({ type: 'agent.event', turnId: 'other', event: { type: 'text', delta: '别的' } });
    emit({ type: 'agent.event', turnId, event: { type: 'session', sessionId: 's1', model: 'm1', cwd: '/' } });
    emit({ type: 'agent.event', turnId, event: { type: 'text', delta: '答' } });
    emit({ type: 'turn.finished', turnId });

    const s = useChat.getState();
    expect(s).toMatchObject({ sessionId: 's1', actualModel: 'm1', running: false, turnId: undefined });
    expect(s.items.map((i) => i.kind)).toEqual(['user', 'assistant']);
    expect(s.items[1]).toMatchObject({ text: '答', streaming: false });
  });

  it('轮次开始前的错误（如会话正在运行）结束等待并显示横幅', () => {
    useChat.getState().send('x');
    emit({ type: 'error', message: '该会话正在运行' });
    expect(useChat.getState()).toMatchObject({ running: false, banner: '该会话正在运行' });
  });

  it('其他轮次的错误忽略，本轮的错误显示横幅', () => {
    const turnId = startTurn();
    emit({ type: 'error', turnId: 'other', message: '别的' });
    expect(useChat.getState().banner).toBeUndefined();
    emit({ type: 'error', turnId, message: '出错' });
    expect(useChat.getState()).toMatchObject({ banner: '出错', running: true });
  });

  it('运行中断线：结束运行并提示输出可能不完整', () => {
    startTurn();
    status('connecting');
    expect(useChat.getState()).toMatchObject({ running: false, connection: 'connecting' });
    expect(useChat.getState().banner).toContain('不完整');
  });

  it('中断与权限答复发送对应消息', () => {
    const turnId = startTurn();
    emit({
      type: 'agent.event',
      turnId,
      event: { type: 'permission_request', requestId: 'p1', toolName: 'Bash', input: {} },
    });
    useChat.getState().respondPermission('p1', false);
    useChat.getState().interrupt();
    expect(sent.slice(1)).toEqual([
      { type: 'permission.respond', requestId: 'p1', allow: false },
      { type: 'chat.interrupt', turnId },
    ]);
    expect(useChat.getState().items.at(-1)).toMatchObject({ kind: 'permission', resolved: 'deny' });
  });
});
