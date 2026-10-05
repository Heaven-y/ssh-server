import type { AgentKind } from './agents';
import type { VersionChange, VersionDiff, VersionExcluded } from './versions';

/** 内部轮次快照；不接受网页传入Git对象或私有引用。 */
export type TurnSnapshot = {
  turnId: string;
  edge: 'base' | 'result';
  tree: string;
  repositoryId: string;
  scope: string;
  revision: string;
  createdAt: number;
};
export type TurnFileChange = VersionChange & { additions: number | null; deletions: number | null; binary: boolean };
export type TurnDiff = VersionDiff & { changes: TurnFileChange[]; excluded: VersionExcluded[] };
export type TurnChangesRecord = {
  turnId: string;
  agent: AgentKind;
  sessionId?: string;
  startedAt: number;
  completedAt?: number;
  phase: 'running' | 'complete' | 'incomplete' | 'unavailable';
  message?: string;
  changes: TurnFileChange[];
};
