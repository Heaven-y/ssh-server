// 复用假 app-server 的通信层，仅补能力目录和压缩生命周期场景。
import { existsSync } from 'node:fs';
import path from 'node:path';

type Message = { id?: string | number; params?: Record<string, unknown> };
type Transport = {
  reply(message: Message, result: unknown): void;
  write(value: unknown): unknown;
  notify(method: string, params: unknown): void;
  mark(name: string): void;
};

export function capabilityHandlers(mode: string, transport: Transport): Record<string, (message: Message) => void> {
  const { reply, notify, write, mark } = transport;
  const nativeThread = 'native-thread';
  const nativeTurn = 'native-turn';
  const fail = (message: Message) =>
    write({ id: message.id, error: { code: -32000, message: 'fixture-private-diagnostic' } });
  const skill = (folder: string, name: string, enabled = true) => ({
    name,
    path: path.join(process.cwd(), '.agents', 'skills', folder, 'SKILL.md'),
    description: '合成技能说明',
    scope: 'repo',
    enabled,
    pluginId: null,
  });
  function skills(message: Message): void {
    if (mode === 'skills-fail') {
      fail(message);
      return;
    }
    if (mode === 'wait-skills') return;
    reply(message, {
      data: [
        {
          cwd: process.cwd(),
          skills: [
            skill('example', mode === 'skill-renamed' ? 'renamed-example' : 'example', mode !== 'skill-disabled'),
            skill('another-example', 'example'),
            skill('disabled', 'disabled-skill', false),
          ],
          errors: mode === 'catalog' ? [{ path: 'invalid/SKILL.md', message: 'fixture-private-diagnostic' }] : [],
        },
      ],
    });
  }
  function models(message: Message): void {
    if (mode === 'models-fail') {
      fail(message);
      return;
    }
    const cursor = message.params?.cursor;
    reply(message, {
      data: cursor
        ? [{ id: 'other', model: 'other-model', displayName: '另一个模型' }]
        : [
            {
              id: 'catalog-entry',
              model: 'suggested-model',
              displayName: '建议模型',
              description: '仅作候选',
              isDefault: true,
              defaultReasoningEffort: 'high',
              supportedReasoningEfforts: [{ reasoningEffort: 'high' }, { reasoningEffort: 'custom-effort' }],
            },
          ],
      nextCursor: !cursor || mode === 'model-loop' ? 'next-page' : null,
    });
  }
  function gate(action: () => void): void {
    const file = process.env.CODEX_TEST_GATE;
    const timer = setInterval(() => {
      if (!file || !existsSync(file)) return;
      clearInterval(timer);
      action();
    }, 10);
  }
  const item = (method: string, turnId = nativeTurn) =>
    notify(method, { threadId: nativeThread, turnId, item: { type: 'contextCompaction', id: 'compact-item' } });
  const completed = (status: string, id = nativeTurn) =>
    notify('turn/completed', { threadId: nativeThread, turn: { id, status, items: [] } });
  function finishCompact(): void {
    if (mode === 'compact-failed') {
      completed('failed');
      return;
    }
    if (mode === 'compact-old-confirmation') {
      item('item/completed', 'old-turn');
      completed('completed', 'old-turn');
      completed('completed');
      return;
    }
    item('item/completed');
    mark('compact-item-completed');
    completed('completed');
  }
  function startCompact(): void {
    notify('turn/started', { threadId: nativeThread, turn: { id: nativeTurn, status: 'inProgress', items: [] } });
    item('item/started');
    if (mode === 'compact-gated-start') return;
    if (mode === 'compact-gated') gate(finishCompact);
    else finishCompact();
  }
  return {
    'skills/list': skills,
    'model/list': models,
    'thread/compact/start': (message) => {
      reply(message, {});
      mark('compact-accepted');
      if (mode === 'compact-gated-start') gate(startCompact);
      else startCompact();
    },
  };
}
