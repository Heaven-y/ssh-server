import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveLocalCommand } from '../../platform/process/executable';
import { runProcess } from '../../platform/process/run';
import type { NativeCapabilityCatalog, NativeInvocation } from '../capability-types';
import type { AgentTurnInput } from '../contracts';
import { withAntigravityDiscoveryProfile, type DiscoveryProfile } from './discovery-profile';
import { startManagementBackend } from './management-process';
import type { ManagementBackend } from './management-rpc';
import {
  antigravityCommandEntries,
  antigravityNativeSkills,
  antigravitySkillEntries,
  mergeAntigravitySkills,
} from './command-catalog';

type Options = { signal?: AbortSignal; env?: NodeJS.ProcessEnv; homeDir?: string };
type Entries = NativeCapabilityCatalog['entries'];

/** 仅为读本机内建目录创建无网络、无账号的临时配置，不能走账号 print 的交互登录分支。 */
function commandEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const removed = new Set([
    'agy_adc_auth',
    'google_application_credentials',
    'google_api_key',
    'gemini_api_key',
    'google_gemini_base_url',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
  ]);
  const isolated = Object.fromEntries(Object.entries(env).filter(([key]) => !removed.has(key.toLowerCase())));
  return {
    ...isolated,
    GEMINI_API_KEY: 'agentdeck-local-catalog',
    GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:9',
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: '127.0.0.1,localhost',
  };
}

async function localReport(profile: DiscoveryProfile, name: 'help' | 'skills', signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const command = resolveLocalCommand('agy', profile.env);
  const result = await runProcess(command.command, [...command.args, '--print', `/${name}`], {
    cwd: profile.root,
    env: profile.env,
    timeoutMs: 15_000,
    outputCap: 512 * 1024,
    signal,
  });
  if (result.exitCode !== 0) throw new Error('原生命令目录读取失败');
  return result.stdout.toString('utf8');
}

async function readSkills(backend: ManagementBackend, dir: string, gemini: string) {
  const normal = antigravityNativeSkills(
    await backend.request('GetAllSkills', {
      workspaceUris: [pathToFileURL(dir).href],
      globalCustomizationDirs: [path.join(gemini, 'config')],
    }),
  );
  const shared = antigravityNativeSkills(
    await backend.request('GetAllSkills', {
      workspaceUris: [],
      globalCustomizationDirs: [gemini],
    }),
  );
  const cli = antigravityNativeSkills(
    await backend.request('GetAllSkills', {
      workspaceUris: [],
      globalCustomizationDirs: [path.join(gemini, 'antigravity-cli')],
    }),
  );
  return mergeAntigravitySkills(normal, shared, cli);
}

/** 原生服务读取目录、清单继承与插件命名，不打开真实会话，也不执行用户 MCP 或 Hooks。 */
export async function discoverAntigravityCommands(dir: string, options: Options = {}): Promise<Entries> {
  options.signal?.throwIfAborted();
  const env = options.env ?? process.env;
  const home = options.homeDir ?? (process.platform === 'win32' ? env.USERPROFILE : env.HOME) ?? homedir();
  return withAntigravityDiscoveryProfile({ modelProvider: 'gemini' }, commandEnvironment(env), async (profile) => {
    const commands = antigravityCommandEntries(await localReport(profile, 'help', options.signal));
    const builtinSkills = await localReport(profile, 'skills', options.signal);
    const backend = await startManagementBackend({
      cwd: profile.root,
      env: profile.env,
      geminiDir: profile.gemini,
      signal: options.signal,
    });
    try {
      const skills = await readSkills(backend, dir, path.join(home, '.gemini'));
      options.signal?.throwIfAborted();
      return [...commands, ...antigravitySkillEntries(builtinSkills, skills, commands)];
    } finally {
      await backend.close();
    }
  });
}

export class AntigravityInvocationError extends Error {}

function matchesSkill(entry: Entries[number] | undefined, invocation: Extract<NativeInvocation, { kind: 'skill' }>) {
  return entry?.available && entry.invocation?.kind === 'skill' && entry.invocation.path === invocation.path;
}

/** 调用前重新读取原生目录；只传技能名，由真实 CLI 展开内容，不复制技能正文到提示词。 */
export async function antigravityInvocationText(input: AgentTurnInput, options: Options = {}): Promise<string> {
  const invocation = input.invocation;
  if (!invocation) return input.text;
  if (invocation.kind !== 'skill') throw new AntigravityInvocationError('此命令尚未接入 Antigravity 对话。');
  const entries = await discoverAntigravityCommands(input.workspace.dir, options);
  const matching = entries.filter((entry) => entry.kind === 'skill' && entry.name === invocation.name);
  if (matching.length !== 1 || !matchesSkill(matching[0], invocation))
    throw new AntigravityInvocationError('所选 Antigravity 技能已变化，请重新选择。');
  return `/${invocation.name}${input.text.trim() ? ` ${input.text}` : ''}`;
}
