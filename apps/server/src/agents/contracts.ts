import type { PermissionSelection } from '@agentdeck/shared/conversation';
import type {
  AgentEvent,
  SessionActionInput,
  SessionCapabilities,
  SessionForkInput,
  SessionRecord,
} from '@agentdeck/shared/conversation';
import type { Workspace } from '@agentdeck/shared/projects';
import type { NativeInvocation } from './capability-types';

export type PermissionAnswer = { allow: boolean; message?: string };
export type AgentTurnInput = {
  workspace: Workspace;
  sessionId?: string;
  model?: string;
  reasoningEffort?: string;
  permission?: PermissionSelection;
  text: string;
  invocation?: NativeInvocation;
  emit(event: AgentEvent): void;
  requestPermission(request: { requestId: string; toolName: string; input: unknown }): Promise<PermissionAnswer>;
};
export type TurnHandle = { interrupt(): Promise<void>; done: Promise<void> };
export type TurnRunner = ((input: AgentTurnInput) => TurnHandle) & {
  /** 关闭长驻运行时；单轮实现可省略。 */
  dispose?(): Promise<void>;
};
/** 各 CLI 的原生会话行：只有原生元数据，不含项目归属与运行态。 */
export type NativeSessionSummary = Omit<SessionRecord, 'agent'> & {
  /** Antigravity 摘要里记录的工作区 URI；其它 CLI 通常没有。 */
  workspaceUris?: string;
};
/**
 * 列表行比 `NativeSessionSummary` 多一个可选 `cwd`，只用于归属裁决，不进入对外契约。
 *
 * 为什么不并进 `NativeSessionSummary`：`read()` 返回的 `session` 用的也是那个类型，
 * 并进去就会改变只读会话的对外形状。Claude 的老会话可能没有 cwd，这类行无法判断属于
 * 哪个项目，必须判为未归属，而不是拿「当前查的是哪个项目」的目录兜底。
 */
export type NativeSessionRow = NativeSessionSummary & { cwd?: string };
export type NativeSessionPageInput = { cursor?: string; limit: number };
export type NativeSessionPage = { items: NativeSessionRow[]; nextCursor?: string };
export type NativeSessionRead = {
  session: NativeSessionSummary;
  cwd: string;
  events: AgentEvent[];
  actualModel?: string;
};
/** 分叉只返回新会话的原生身份与目录，不复制历史为新的输入。 */
export type NativeSessionFork = Pick<NativeSessionRead, 'session' | 'cwd'>;

export type SessionProvider = {
  capabilities?: Partial<SessionCapabilities>;
  list(dir: string, signal?: AbortSignal, archived?: boolean): Promise<NativeSessionRow[]>;
  page?(
    dir: string,
    input: NativeSessionPageInput,
    signal?: AbortSignal,
    archived?: boolean,
  ): Promise<NativeSessionPage>;
  read(id: string, dir: string, signal?: AbortSignal): Promise<NativeSessionRead>;
  /** 返回已核实的原生目录；多目录 CLI 同时保留完整归属元数据。 */
  assertBelongs(
    id: string,
    dir: string,
    signal?: AbortSignal,
  ): Promise<void | string | { cwd: string; workspaceUris: string }>;
  mutate(id: string, dir: string, input: SessionActionInput): Promise<void>;
  fork(id: string, dir: string, input: SessionForkInput): Promise<NativeSessionFork>;
};
