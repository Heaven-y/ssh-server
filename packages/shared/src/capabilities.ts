import { z } from 'zod';
import type { AgentKind } from './agents';

export const CapabilitySelectionSchema = z.object({ id: z.string().min(1).max(100) }).strict();
export type CapabilitySelection = z.infer<typeof CapabilitySelectionSchema>;
export type AgentCapability = {
  id: string;
  kind: 'skill' | 'command';
  name: string;
  description: string;
  source?: string;
  aliases?: string[];
  argumentHint?: string;
  available: boolean;
  unavailableReason?: string;
  requiresSession: boolean;
  supportsArguments: boolean;
};
export type AgentModel = { id: string; label: string; description?: string; reasoningEfforts?: string[] };
export type AgentCapabilities = {
  agent: AgentKind;
  /** false 表示尚未向 CLI 读取；缺省兼容已取得的目录。 */
  discovered?: boolean;
  /** 模型可从磁盘恢复；技能与命令须在本进程从相同目录重新发现。 */
  commandsDiscovered?: boolean;
  entries: AgentCapability[];
  models: AgentModel[];
  warnings: string[];
  /** 分组反馈；空串代表模型正常，技能提示不能混进模型菜单。 */
  modelWarning?: string;
  commandWarnings?: string[];
};

/** 原生统计与原生估算均保留来源；没有给出的窗口或比例不推算。 */
export type ContextUsage = {
  usedTokens: number;
  windowTokens?: number;
  percentage?: number;
  model?: string;
  source: 'claude_estimate' | 'codex_native';
};
export type CompactionState = {
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  trigger?: 'manual' | 'auto';
  beforeTokens?: number;
  afterTokens?: number;
  message?: string;
};
