import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveLocalCommand } from '../../process/executable';
import { runProcess } from '../../process/run';
import { parseAntigravityModelList, type AntigravityModelSettings } from './model-catalog';

/** agy models 会加载原生 MCP；模型发现必须使用只含模型设置的独立目录。 */
export async function discoverGeminiModels(
  settings: AntigravityModelSettings,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const command = resolveLocalCommand('agy', env);
  const root = await mkdtemp(path.join(tmpdir(), 'agentdeck-agy-models-'));
  try {
    const native = path.join(root, '.gemini', 'antigravity-cli');
    await mkdir(native, { recursive: true });
    await writeFile(path.join(native, 'settings.json'), JSON.stringify({ ...settings, enableTelemetry: false }), {
      mode: 0o600,
    });
    // 原生后台更新器会再开控制台；仅在临时目录标记本次已检查，不改用户的更新状态。
    await writeFile(path.join(native, 'last_check.timestamp'), '', { mode: 0o600 });
    const overrides = new Set([
      'home',
      'userprofile',
      'homedrive',
      'homepath',
      'appdata',
      'localappdata',
      'xdg_config_home',
      'xdg_cache_home',
      'antigravity_gemini_dir',
    ]);
    const isolated = {
      ...Object.fromEntries(Object.entries(env).filter(([key]) => !overrides.has(key.toLowerCase()))),
      HOME: root,
      USERPROFILE: root,
      HOMEDRIVE: path.parse(root).root.replace(/[\\/]$/, ''),
      HOMEPATH: root.slice(path.parse(root).root.length - 1),
      APPDATA: path.join(root, 'roaming'),
      LOCALAPPDATA: path.join(root, 'local'),
      XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_CACHE_HOME: path.join(root, 'cache'),
      ANTIGRAVITY_GEMINI_DIR: path.join(root, '.gemini'),
    };
    const result = await runProcess(command.command, [...command.args, 'models'], {
      cwd: root,
      env: isolated,
      timeoutMs: 15000,
      outputCap: 256 * 1024,
      signal,
    });
    if (result.exitCode !== 0) throw new Error('暂时无法读取 Antigravity 模型。');
    return parseAntigravityModelList(result.stdout.toString('utf8'));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
