import type { AgentKind, AgentEvent, ContextUsage, CompactionState, SessionRef } from '@agentdeck/shared/conversation';
import type { ChatState } from './chat-state';
import { ApiError } from '../../lib/http';
export const DEFAULT_REASONING_EFFORTS: Record<AgentKind, string> = {
  claude: '',
  codex: '',
  antigravity: '',
};
/** 未显式选择的模型和强度都由原生配置决定。 */
export const EMPTY_MODEL_OVERRIDES: Record<AgentKind, string> = { claude: '', codex: '', antigravity: '' };
export function historyFailure(agent: AgentKind, error: unknown): Pick<ChatState, 'historyError' | 'historyNotice'> {
  const notReplayable = agent === 'antigravity' && error instanceof ApiError && error.code === 'session_not_replayable';
  if (notReplayable)
    return { historyNotice: 'Antigravity 的原生历史暂不能回放；可以继续此会话，本次收到的内容会显示在这里。' };
  return { historyError: `加载会话失败：${error instanceof Error ? error.message : '请重试'}` };
}

export function historyViewVersion(
  current: ChatState,
  session: SessionRef,
  generation: number,
  options?: { preserveDraft?: boolean },
) {
  return options?.preserveDraft && current.agent === session.agent && current.sessionId === session.sessionId
    ? current.conversationVersion
    : generation;
}

export function historyParameters(current: ChatState, session: SessionRef) {
  if (current.agent === session.agent && current.sessionId === session.sessionId)
    return {
      modelOverrides: current.modelOverrides,
      reasoningEfforts: current.reasoningEfforts,
      permission: current.permission,
    };
  return {
    modelOverrides: { ...EMPTY_MODEL_OVERRIDES },
    reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS },
    permission: undefined,
  };
}

export function historyRetryItems(current: ChatState, session: SessionRef, options?: { preserveDraft?: boolean }) {
  return options?.preserveDraft && current.agent === session.agent && current.sessionId === session.sessionId
    ? current.items
    : [];
}

export function sameSession(current: ChatState, workspaceId: string, session: SessionRef): boolean {
  return (
    current.workspaceId === workspaceId && current.agent === session.agent && current.sessionId === session.sessionId
  );
}

export function nativeStatus(event: AgentEvent): { contextUsage?: ContextUsage | null; compaction?: CompactionState } {
  if (event.type === 'context') return { contextUsage: event.usage };
  if (event.type === 'compaction') return { compaction: event.state };
  return {};
}

export function reportedModel(model?: string): string | undefined {
  return model?.trim() || undefined;
}
