import type { AgentEvent, CompactionState } from '@ssh-server/shared';

type Progress = {
  id?: string;
  trigger: 'manual' | 'auto';
  beforeTokens?: number;
  afterTokens?: number;
  confirmed: boolean;
};

/** 手动压缩只有原生 item 完成且本轮完成才算成功；自动压缩可在普通轮次中先完成。 */
export class CodexCompaction {
  private progress?: Progress;
  private manualSettled = false;
  private readonly completedIds = new Set<string>();
  confirmed = false;
  constructor(private readonly manual: boolean) {}

  startManual(usedTokens?: number): AgentEvent[] {
    if (!this.manual || this.progress) return [];
    this.progress = { trigger: 'manual', beforeTokens: usedTokens, confirmed: false };
    return [this.event('running')];
  }

  item(id: string, complete: boolean, usedTokens?: number): AgentEvent[] {
    if (this.completedIds.has(id)) return [];
    const started = !this.progress;
    this.progress ??= {
      trigger: this.manual ? 'manual' : 'auto',
      beforeTokens: complete ? undefined : usedTokens,
      confirmed: false,
    };
    this.progress.id = id;
    if (!complete) return started ? [this.event('running')] : [];
    this.completedIds.add(id);
    this.progress.confirmed = true;
    this.progress.afterTokens = usedTokens;
    this.confirmed = true;
    if (this.manual) return [];
    const event = this.event('completed');
    this.progress = undefined;
    return [event];
  }

  finish(status: string): AgentEvent[] {
    if (this.manualSettled || (!this.manual && !this.progress)) return [];
    this.progress ??= { trigger: 'manual', confirmed: false };
    const result =
      status === 'interrupted'
        ? 'cancelled'
        : status === 'completed' && this.progress.confirmed
          ? 'completed'
          : 'failed';
    const event = this.event(result);
    if (this.manual) this.manualSettled = true;
    this.progress = undefined;
    return [event];
  }

  private event(status: CompactionState['status']): AgentEvent {
    return {
      type: 'compaction',
      state: {
        status,
        trigger: this.progress?.trigger,
        ...(this.progress?.beforeTokens !== undefined ? { beforeTokens: this.progress.beforeTokens } : {}),
        ...(status === 'completed' && this.progress?.afterTokens !== undefined
          ? { afterTokens: this.progress.afterTokens }
          : {}),
      },
    };
  }
}
