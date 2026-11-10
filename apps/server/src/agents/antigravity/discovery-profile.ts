import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AntigravityModelSettings } from './model-catalog';
import { antigravityBackgroundEnvironment } from './process-environment';

export type DiscoveryProfile = { root: string; gemini: string; env: NodeJS.ProcessEnv };
const overridden = new Set([
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

/** 发现进程只得到模型白名单；不会加载真实用户目录的 MCP、Hooks 或更新器。 */
export async function withAntigravityDiscoveryProfile<T>(
  settings: AntigravityModelSettings,
  env: NodeJS.ProcessEnv,
  run: (profile: DiscoveryProfile) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), 'agentdeck-agy-catalog-'));
  const gemini = path.join(root, '.gemini');
  try {
    const native = path.join(gemini, 'antigravity-cli');
    await mkdir(native, { recursive: true });
    await writeFile(path.join(native, 'settings.json'), JSON.stringify({ ...settings, enableTelemetry: false }), {
      mode: 0o600,
    });
    await writeFile(path.join(native, 'last_check.timestamp'), '', { mode: 0o600 });
    const isolated = {
      ...Object.fromEntries(Object.entries(env).filter(([key]) => !overridden.has(key.toLowerCase()))),
      HOME: root,
      USERPROFILE: root,
      HOMEDRIVE: path.parse(root).root.replace(/[\\/]$/, ''),
      HOMEPATH: root.slice(path.parse(root).root.length - 1),
      APPDATA: path.join(root, 'roaming'),
      LOCALAPPDATA: path.join(root, 'local'),
      XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_CACHE_HOME: path.join(root, 'cache'),
      ANTIGRAVITY_GEMINI_DIR: gemini,
    };
    return await run({ root, gemini, env: antigravityBackgroundEnvironment(isolated) });
  } finally {
    await rm(root, { recursive: true, maxRetries: 3, retryDelay: 100 });
  }
}
