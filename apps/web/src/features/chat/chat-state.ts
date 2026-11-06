import type {
  AgentKind,
  AgentCapability,
  ContextUsage,
  CompactionState,
  SessionActionInput,
  SessionRef,
} from '@agentdeck/shared/conversation';
import type { ProductSettings } from '@agentdeck/shared/settings';
import type { ConnectionStatus } from '../../lib/ws';
import type { ChatItem } from './chat-reducer';
export type SessionOperation = { action: SessionActionInput['action'] | 'fork'; pending: boolean; error?: string };
export type ChatState = {
  connection: ConnectionStatus;
  workspaceId?: string;
  agent: AgentKind;
  sessionId?: string;
  modelOverrides: Record<AgentKind, string>;
  defaults: Pick<ProductSettings, 'defaultAgent'>;
  initialDefaultsEligible: boolean;
  reasoningEfforts: Record<AgentKind, string>;
  actualModel?: string;
  /** 仅保存本页已读取/运行的原生模型元数据，不从默认或显式选择推导。 */
  sessionModels: Record<string, { actualModel?: string; nativeModel?: string }>;
  selectedCapability?: AgentCapability;
  contextUsage?: ContextUsage | null;
  compaction?: CompactionState;
  items: ChatItem[];
  inspectedItemId?: string;
  inspectorRequest: number;
  inspectItem(id?: string): void;
  /** 网页选择代次；原生首次返回sessionId不会重建时间线。 */
  conversationVersion: number;
  running: boolean;
  turnId?: string;
  pendingClientTurnId?: string;
  interruptRequested: boolean;
  loadingHistory: boolean;
  historyError?: string;
  historyNotice?: string;
  banner?: string;
  sessionOperations: Record<string, SessionOperation>;
  manageSession(workspaceId: string, session: SessionRef, input: SessionActionInput): Promise<boolean>;
  selectWorkspace(id?: string): void;
  removeWorkspace(id: string, nextId?: string): void;
  resetWorkspaceConversation(id: string, expectedVersion: number): void;
  newSession(agent?: AgentKind): void;
  setAgent(agent: AgentKind): void;
  openSession(session: SessionRef, options?: { preserveDraft?: boolean }): Promise<void>;
  setModel(model: string): void;
  setDefaults(settings: ProductSettings): void;
  touchDraft(): void;
  setReasoningEffort(effort: string): void;
  selectCapability(capability?: AgentCapability): void;
  send(text: string): boolean;
  interrupt(): void;
  respondPermission(requestId: string, allow: boolean): void;
  dismissBanner(): void;
};
