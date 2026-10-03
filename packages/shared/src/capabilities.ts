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
  entries: AgentCapability[];
  models: AgentModel[];
  warnings: string[];
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
