import type { NativeCapabilityCatalog } from '../capability-types';
import { resolveLocalCommand } from '../../process/executable';
import { runProcess } from '../../process/run';

/** agy 当前只公开文本目录，不猜测标识或把 TUI 命令冒充可调用能力。 */
export async function discoverAntigravityCapabilities(
  _dir: string,
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<NativeCapabilityCatalog> {
  const command = resolveLocalCommand('agy', options.env ?? process.env);
  const result = await runProcess(command.command, [...command.args, 'models'], {
    timeoutMs: 15000,
    outputCap: 256 * 1024,
    signal: options.signal,
    env: options.env,
  });
  const requiresLogin = /please sign in to view available models/i.test(result.stderr.toString('utf8'));
  const message = requiresLogin
    ? '请先在本机 agy 登录，再刷新模型列表。'
    : result.exitCode !== 0
      ? 'Antigravity 模型列表读取失败，请检查本机登录与配置。'
      : '当前 agy 提供文本模型清单，可用 agy models 查看并手动填写模型 ID，或沿用原生配置。';
  return {
    entries: [],
    models: [],
    warnings: [message],
  };
}
