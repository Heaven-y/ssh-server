import type { AgentEvent, CompactionState } from '@ssh-server/shared';

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => !!value && typeof value === 'object';
const tokens = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** 只过滤原生明确标记或本轮已见的消息；边界后的新 UUID 仍正常输出。 */
export class ClaudeReplayFilter {
  private seen = new Set<string>();

  skip(message: Rec): boolean {
    if (message.type === 'system' && message.subtype === 'compact_boundary') this.remember(message.compact_metadata);
    if (message.type !== 'user' && message.type !== 'assistant') return false;
    if (typeof message.uuid !== 'string') return false;
    const duplicate = this.seen.has(message.uuid);
    this.seen.add(message.uuid);
    return duplicate;
  }

  private remember(value: unknown) {
    if (!isRec(value)) return;
    const preserved = isRec(value.preserved_messages) ? value.preserved_messages : {};
    const segment = isRec(value.preserved_segment) ? value.preserved_segment : {};
    const ids = [
      preserved.anchor_uuid,
      segment.head_uuid,
      segment.tail_uuid,
      segment.anchor_uuid,
      ...strings(preserved.uuids),
      ...strings(preserved.all_uuids),
    ];
    for (const uuid of ids) if (typeof uuid === 'string') this.seen.add(uuid);
  }
}

export function claudeCompactionBoundary(message: Rec): AgentEvent[] {
  if (message.subtype !== 'compact_boundary' || !isRec(message.compact_metadata)) return [];
  const metadata = message.compact_metadata;
  const trigger = metadata.trigger === 'manual' || metadata.trigger === 'auto' ? metadata.trigger : undefined;
  return [
    {
      type: 'compaction',
      state: {
        status: 'completed',
        trigger,
        beforeTokens: tokens(metadata.pre_tokens),
        afterTokens: tokens(metadata.post_tokens),
      },
    },
  ];
}

export function claudeCompactionStatus(message: Rec): AgentEvent[] {
  if (message.subtype !== 'status') return [];
  if (message.status === 'compacting') return [{ type: 'compaction', state: { status: 'running' } }];
  if (message.compact_result === 'failed')
    return [
      { type: 'compaction', state: { status: 'failed', message: 'Claude 原生压缩失败，请重试或检查本机运行时' } },
    ];
  // status success 尚未确认边界，等待 compact_boundary。
  return [];
}

const interruptedState = (state: CompactionState, interrupted: boolean): CompactionState =>
  state.status === 'failed' && interrupted ? { ...state, status: 'cancelled', message: '压缩已中断' } : state;

/** 不读取 assistant/result 文本；压缩重放的旧失败消息不能覆盖本次结果。 */
export class ClaudeCompactionTracker {
  private running = false;
  private terminal = false;
  private confirmed = false;
  constructor(private readonly manual: boolean) {}

  observe(state: CompactionState, interrupted = false): CompactionState | undefined {
    if (state.status === 'completed' && this.manual && (!this.running || state.trigger !== 'manual')) return undefined;
    this.running = state.status === 'running';
    this.terminal = state.status !== 'running';
    if (this.running) this.confirmed = false;
    if (state.status === 'completed') this.confirmed = true;
    const current = interruptedState(state, interrupted);
    return this.manual ? { ...current, trigger: 'manual' } : current;
  }

  finish(interrupted: boolean): CompactionState | undefined {
    if (this.confirmed || this.terminal || (!this.manual && !this.running)) return undefined;
    this.terminal = true;
    return {
      status: interrupted ? 'cancelled' : 'failed',
      trigger: this.manual ? 'manual' : undefined,
      message: interrupted ? '压缩已中断' : '未收到 Claude 原生压缩完成确认',
    };
  }

  get manualFailed(): boolean {
    return this.manual && !this.confirmed;
  }
}
