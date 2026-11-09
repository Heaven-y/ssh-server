import { resolveLocalCommand } from '../../platform/process/executable';
import { runProcess } from '../../platform/process/run';
import { parseAntigravityModelList, type AntigravityModelSettings } from './model-catalog';
import { withAntigravityDiscoveryProfile } from './discovery-profile';

/** agy models 会加载原生 MCP；模型发现必须使用只含模型设置的独立目录。 */
export async function discoverAntigravityModels(
  settings: AntigravityModelSettings,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const command = resolveLocalCommand('agy', env);
  return withAntigravityDiscoveryProfile(settings, env, async ({ root, env: isolated }) => {
    const result = await runProcess(command.command, [...command.args, 'models'], {
      cwd: root,
      env: isolated,
      timeoutMs: 15000,
      outputCap: 256 * 1024,
      signal,
    });
    if (result.exitCode !== 0) throw new Error('暂时无法读取 Antigravity 模型。');
    return parseAntigravityModelList(result.stdout.toString('utf8'));
  });
}
