import type { AgentKind } from '@agentdeck/shared/conversation';
import { createHash } from 'node:crypto';
import type { CliConfiguration, ModelSettingsEnvironment, EnvironmentSnapshot as Snapshot } from './contracts';
export const modelSettingsRevision = (native: string, snapshot?: Snapshot) =>
  snapshot ? createHash('sha256').update(`${native}:${snapshot.document.revision}`).digest('hex') : native;

/** 只读取状态供高级设置提示，不解密、列出变量或推断 CLI 的认证优先级。 */
export async function advancedModelEnvironmentWarnings(
  agent: AgentKind,
  names: string[],
  environment?: ModelSettingsEnvironment,
): Promise<string[]> {
  if (!environment) return [];
  try {
    const metadata = await environment.read(agent);
    const affected = metadata.variables.some(
      (variable) => names.includes(variable.name) && variable.mode !== 'inherit',
    );
    return affected ? ['连接另有高级设置，可在启动环境中查看。'] : [];
  } catch {
    // 此提示不参与保存事务，读取状态失败不能把已保存配置报告成写入失败。
    return [];
  }
}

export const nativeConfigurationDefaults = {
  readEnvironment: () => Promise.resolve(undefined),
  prepare: (_config, changes) =>
    Promise.resolve({
      changes,
      connection: { save: () => Promise.resolve(undefined), restore: () => Promise.resolve() },
    }),
  launchNote: '保存用于新启动的 CLI。已有会话可在空闲时重新启动；不会自动发送消息。旧值不会回填。',
} satisfies Pick<CliConfiguration, 'readEnvironment' | 'prepare' | 'launchNote'>;
