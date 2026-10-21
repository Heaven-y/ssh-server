import type { AgentKind } from './agents';
import type { TurnFileChange } from './turn-files';

/** 一轮对话的文件变更记录；只描述原生报告与状态对比的结果，不含 Git 对象。 */
export type TurnChangesRecord = {
  turnId: string;
  agent: AgentKind;
  sessionId?: string;
  startedAt: number;
  completedAt?: number;
  phase: 'complete' | 'incomplete';
  message?: string;
  changes: TurnFileChange[];
};
