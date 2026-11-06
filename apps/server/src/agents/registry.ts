import type { AgentKind } from '@agentdeck/shared/conversation';
import { configuration as antigravity } from './antigravity/configuration';
import { configuration as claude } from './claude/configuration';
import { configuration as codex } from './codex/configuration';
import type { CliConfiguration } from './common/configuration/contracts';
/** 内置 CLI 的静态注册；接口约束共用流程，原生细节由各适配器持有。 */
export const cliConfigurations: Record<AgentKind, CliConfiguration> = { claude, codex, antigravity };
