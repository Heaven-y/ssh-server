import path from 'node:path';
import type { CliInstallation } from './types';
import { envValue, fingerprint, hash, objectValue, readSmallFile, type BackendContext } from './backend-support';

export type ClaudePolicy = {
  channel: 'latest' | 'stable';
  disabled: boolean;
  invalid: boolean;
  constrained: boolean;
  identity: unknown[];
};
function enabled(value: unknown): boolean {
  return value === '1' || value === 'true' || value === true;
}

function applySettings(result: ClaudePolicy, settings: Record<string, unknown>): void {
  if (settings.autoUpdatesChannel !== undefined) {
    if (settings.autoUpdatesChannel === 'stable' || settings.autoUpdatesChannel === 'latest')
      result.channel = settings.autoUpdatesChannel;
    else result.invalid = true;
  }
  result.disabled ||= enabled(objectValue(settings.env)?.DISABLE_UPDATES);
  result.constrained ||=
    settings.minimumVersion !== undefined ||
    settings.requiredMinimumVersion !== undefined ||
    settings.requiredMaximumVersion !== undefined;
}

async function readSettings(file: string, result: ClaudePolicy): Promise<void> {
  try {
    const text = await readSmallFile(file);
    const settings = objectValue(JSON.parse(text));
    if (!settings) throw new Error('invalid');
    applySettings(result, settings);
    result.identity.push([file, hash(text)]);
  } catch (error) {
    if (objectValue(error)?.code !== 'ENOENT') result.invalid = true;
    result.identity.push([file, await fingerprint(file), result.invalid]);
  }
}

export async function claudePolicy(env: NodeJS.ProcessEnv, context: BackendContext): Promise<ClaudePolicy> {
  const configDir = envValue(env, 'CLAUDE_CONFIG_DIR') ?? path.join(context.homeDir, '.claude');
  const result: ClaudePolicy = {
    channel: 'latest',
    disabled: enabled(envValue(env, 'DISABLE_UPDATES')),
    invalid: false,
    constrained: false,
    identity: [],
  };
  await readSettings(path.join(configDir, 'settings.json'), result);
  // 官方 managed-settings 文件优先于用户设置；缺失时保持用户设置，读取失败则停止自动更新。
  const programFiles = envValue(env, 'ProgramFiles');
  if (context.platform === 'win32' && programFiles)
    await readSettings(path.join(programFiles, 'ClaudeCode/managed-settings.json'), result);
  if (context.platform === 'linux') await readSettings('/etc/claude-code/managed-settings.json', result);
  if (context.platform === 'darwin')
    await readSettings('/Library/Application Support/ClaudeCode/managed-settings.json', result);
  return result;
}

export function applyClaudePolicy(installation: CliInstallation, settings: ClaudePolicy): void {
  installation.channel = settings.channel;
  if (!settings.disabled && !settings.invalid && !(settings.constrained && installation.npm)) return;
  installation.canInstall = false;
  installation.canUpdate = false;
  if (settings.disabled) installation.message = 'Claude 配置已禁用更新，请先在原生配置中调整 DISABLE_UPDATES。';
  else if (settings.invalid) installation.message = 'Claude 更新配置无法读取或识别，请先检查原生设置。';
  else installation.message = 'Claude 配置了版本限制，请通过原生命令按现有策略更新。';
}
