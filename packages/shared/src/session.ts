import { z } from 'zod';
import { AgentKindSchema, type AgentKind } from './agents';
import type { AgentEvent } from './events';

/** 本机探测的四种结果：可用、未安装、接口变化、凭据缺失。 */
export const ProbeStatusSchema = z.enum(['available', 'missing', 'changed', 'credential-missing']);
export type ProbeStatus = z.infer<typeof ProbeStatusSchema>;

/** 只报告本机事实，不发模型请求：missing 列出缺失的能力（flag 或子命令）。 */
export const AgentProbeSchema = z.object({
  agent: AgentKindSchema,
  status: ProbeStatusSchema,
  version: z.string().min(1).optional(),
  missing: z.array(z.string().min(1)).optional(),
  message: z.string().min(1).optional(),
});
export type AgentProbe = z.infer<typeof AgentProbeSchema>;

/** 会话身份 = CLI + 该 CLI 自己的原生会话 id，不能跨 CLI 转换。 */
export type SessionRef = { agent: AgentKind; sessionId: string };

/** 项目会话列表的一行；projectId 为 null 表示不属于任何已配置项目。 */
export const SessionSummarySchema = z.object({
  agent: AgentKindSchema,
  sessionId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  title: z.string(),
  updatedAt: z.string().min(1),
  running: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

/** 各 CLI 原生存储里的会话行：只有原生元数据，不含项目归属与运行态。 */
export type SessionRecord = SessionRef & {
  summary: string;
  lastModified: number;
  /** 原生会话记录的模型配置，不代表逐轮执行遥测。 */
  nativeModel?: string;
};
export type SessionHistory = { session: SessionRecord; events: AgentEvent[]; actualModel?: string };
