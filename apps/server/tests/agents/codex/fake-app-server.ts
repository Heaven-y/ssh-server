// 独立假进程：只实现测试所需协议，不访问真实配置或模型。
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { capabilityHandlers } from './fake-capabilities';

type Message = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};
const mode = process.env.CODEX_TEST_MODE ?? 'normal';
const logFile = process.env.CODEX_TEST_LOG;
const write = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const reply = (message: Message, result: unknown) => write({ id: message.id, result });
const notify = (method: string, params: unknown) => write({ method, params });
const threadId = 'native-thread';
const turnId = 'native-turn';
const thread = (id = threadId, cwd = process.cwd()) => ({
  id,
  sessionId: 'fork-tree-root',
  cwd,
  model: 'native-model',
  name: null,
  preview: '原生会话',
  createdAt: 1,
  updatedAt: 10,
  source: mode === 'subagent-session' ? { subAgent: 'review' } : 'appServer',
  parentThreadId: null,
  status: { type: mode === 'active-session' ? 'active' : 'notLoaded' },
  turns: [],
});
const end = (status = 'completed') =>
  notify('turn/completed', {
    threadId,
    turn: {
      id: turnId,
      status,
      items: [],
      durationMs: 30,
      error: status === 'failed' ? { message: 'fixture-sensitive-diagnostic' } : null,
    },
  });
const readThread = (message: Message) => {
  const id = String(message.params?.threadId);
  const result = thread(
    mode === 'wrong-session-id' ? 'another-thread' : id,
    id === 'foreign' ? path.dirname(process.cwd()) : process.cwd(),
  );
  const turns = [
    {
      id: 'old-turn',
      status: 'completed',
      itemsView: mode === 'partial-history' ? 'summary' : 'full',
      items: [
        { id: 'user', type: 'userMessage', content: [{ type: 'text', text: '历史问题' }] },
        { id: 'assistant', type: 'agentMessage', text: '历史回复' },
      ],
    },
  ];
  reply(message, { thread: { ...result, turns: message.params?.includeTurns ? turns : [] } });
};
function listThreads(message: Message): void {
  const cursor = message.params?.cursor;
  const first = [
    thread(),
    thread('foreign', path.dirname(process.cwd())),
    { ...thread('subagent'), parentThreadId: 'parent', source: { subAgent: {} } },
  ];
  reply(message, {
    data: cursor ? [thread('second')] : first,
    nextCursor: !cursor || mode === 'cursor-loop' ? 'page-2' : null,
  });
}
function approval(): void {
  const kind = mode === 'approval-permissions' ? 'permissions' : 'commandExecution';
  write({
    id: 'native-approval-id',
    method: `item/${kind}/requestApproval`,
    params: {
      threadId,
      turnId,
      itemId: 'same-item',
      reason: '需要本次确认',
      cwd: process.cwd(),
      command: 'echo test',
      permissions: { network: { enabled: true }, fileSystem: { read: ['project'], write: null } },
    },
  });
}
function afterStart(): void {
  if (mode.startsWith('approval')) {
    approval();
    if (mode === 'approval-exit') setTimeout(() => process.exit(1), 40);
    return;
  }
  if (mode === 'unknown-request') {
    write({ id: 900, method: 'item/unsupported/request', params: { threadId, turnId } });
    return;
  }
  if (mode === 'delayed-start' || mode === 'ignore-interrupt') return;
  notify('item/agentMessage/delta', { threadId, turnId, itemId: 'answer', delta: '流式回复' });
  notify('item/completed', { threadId, turnId, item: { id: 'answer', type: 'agentMessage', text: '流式回复' } });
  end(mode === 'turn-failed' ? 'failed' : 'completed');
}
function start(message: Message): void {
  const respond = () => {
    reply(message, { turn: { id: turnId, status: 'inProgress', items: [] } });
    setTimeout(afterStart, 10);
  };
  if (mode === 'delayed-start') setTimeout(respond, 150);
  else respond();
}
function config(message: Message): void {
  if (mode === 'rpc-error') {
    write({ id: message.id, error: { code: -32000, message: 'fixture-sensitive-diagnostic' } });
    return;
  }
  if (mode !== 'wait-config')
    reply(message, {
      config: { developer_instructions: '原生约束', model: 'native-model', model_provider: 'native-provider' },
    });
}
function echo(message: Message): void {
  const bytes = Buffer.from(`${JSON.stringify({ id: message.id, result: { value: '中文分片' } })}\n`);
  const split = bytes.indexOf(Buffer.from('中文')) + 1;
  process.stdout.write(bytes.subarray(0, split));
  setTimeout(() => process.stdout.write(bytes.subarray(split)), 5);
}
function mutation(message: Message): void {
  const complete = () => {
    if (logFile) appendFileSync(logFile, `${JSON.stringify({ fixtureCompleted: message.method })}\n`);
    reply(message, {});
  };
  if (mode === 'delayed-mutation') setTimeout(complete, 150);
  else complete();
}
const handlers: Record<string, (message: Message) => void> = {
  ...capabilityHandlers(mode, {
    reply,
    notify,
    write,
    mark: (name) => {
      if (logFile) appendFileSync(logFile, `${JSON.stringify({ fixturePhase: name })}\n`);
    },
  }),
  initialize: (message) => reply(message, { userAgent: 'fixture' }),
  initialized: () => {},
  'config/read': config,
  'thread/start': (message) => reply(message, { thread: thread(), model: 'native-model' }),
  'thread/resume': (message) =>
    reply(message, { thread: thread(String(message.params?.threadId)), model: 'native-model' }),
  'thread/read': readThread,
  'thread/list': listThreads,
  'thread/name/set': mutation,
  'thread/delete': mutation,
  'thread/archive': mutation,
  'thread/unarchive': mutation,
  'turn/start': start,
  'turn/interrupt': (message) => {
    if (mode !== 'ignore-interrupt') {
      reply(message, {});
      end('interrupted');
    }
  },
  echo,
  hang: () => {},
  oversize: () => {
    process.stdout.write('x'.repeat(8 * 1024 * 1024 + 1));
  },
  exit: () => {
    process.stderr.write('fixture-secret-must-not-leak');
    process.exit(1);
  },
};
createInterface({ input: process.stdin })
  .on('line', (line) => {
    const message = JSON.parse(line) as Message;
    if (logFile) appendFileSync(logFile, `${JSON.stringify(message)}\n`);
    if (message.method) handlers[message.method]?.(message);
    else end();
  })
  .on('close', () => process.exit(0));
