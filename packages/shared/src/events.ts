// Agent 对话事件：后端把 Claude / Codex 的原始消息统一转换成这些事件，再推送给前端
import type { AgentKind } from './agents';
import type { CompactionState, ContextUsage } from './capabilities';

export type AgentEvent =
  | { type: 'context'; usage: ContextUsage | null }
  | { type: 'compaction'; state: CompactionState }
  /** 会话开始或继续，sessionId 由 Agent 分配 */
  | { type: 'session'; sessionId: string; model: string; cwd: string; agent?: AgentKind }
  /** 用户消息（只出现在历史记录中，实时对话由前端自己显示） */
  | { type: 'user_message'; text: string }
  /** 助手文本增量 */
  | { type: 'text'; delta: string }
  /** 思考过程增量 */
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  /** Agent 请求执行需要确认的操作，等待网页答复 */
  | { type: 'permission_request'; requestId: string; toolName: string; input: unknown; description?: string }
  | { type: 'permission_resolved'; requestId: string; decision: 'allowed' | 'denied' | 'cancelled' }
  | { type: 'turn_end'; isError: boolean; durationMs?: number; costUsd?: number }
  | { type: 'error'; message: string };
