import type { AgentKind } from '@agentdeck/shared/conversation';
import { SessionToolsInputSchema, type SessionToolsInput, type SessionToolsStatus } from '@agentdeck/shared/settings';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { FileAccessError } from '../platform/files/errors';
import {
  assertDirectoryUnchanged,
  inspectDirectory,
  readConfigFile,
  writeConfigFile,
} from '../platform/files/safe-file';
import { nativeFileTransaction } from '../platform/files/transactions';
import { resolveLocalCommand } from '../platform/process/executable';
import { runProcess, type ProcessRunner } from '../platform/process/run';
import { buildSessionToolsCommand, type SessionToolsCommand } from './session-tools-command';
import {
  editSessionToolsConfig,
  ownsSessionToolsEntry,
  parseSessionToolsConfig,
  SESSION_TOOLS_NAME,
  sessionToolsEntry,
  type SessionToolsEntry,
} from './session-tools-format';

const errors = {
  invalid_request: [400, '会话工具请求格式不正确。'],
  revision_conflict: [409, '原生配置或启动环境已改变，请刷新后重试。'],
  entry_conflict: [409, '同名 agentdeck_sessions 已被其他配置占用，请先使用原生 CLI 处理。'],
  invalid_config: [409, '原生 MCP 配置无法安全读取，请先修复配置。'],
  unavailable: [409, '找不到该 CLI 的原生入口，请检查本机安装和启动环境。'],
  unsupported_runtime: [409, '便携版的运行目录会变化，请使用安装版启用会话读取。'],
  native_failed: [500, '原生 CLI 未能更新 MCP 配置，请刷新并检查原生配置。'],
  restart_failed: [500, '配置已保存，但 CLI 重新加载失败，请结束会话后重试。'],
  io_error: [500, '无法访问原生 MCP 配置，请检查文件和目录权限。'],
} as const;
export class SessionToolsError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof errors) {
    super(errors[code][1]);
    this.status = errors[code][0];
  }
}
type Deps = {
  configDir: string;
  homeDir?: string;
  command?: SessionToolsCommand;
  registrationAvailable?: boolean;
  environment(agent: AgentKind): Promise<NodeJS.ProcessEnv>;
  resolveCommand?: typeof resolveLocalCommand;
  run?: ProcessRunner;
  withIdleAgent?<T>(agent: AgentKind, operation: () => Promise<T>): Promise<T>;
  restart?(agent: AgentKind): Promise<void>;
  onSaved?(agent: AgentKind): void | Promise<void>;
};
type Snapshot = Awaited<ReturnType<typeof readConfigFile>>;
type Context = { agent: AgentKind; env: NodeJS.ProcessEnv; file: string; command: SessionToolsEntry };
type State = { snapshot: Snapshot; status: SessionToolsStatus; conflict: boolean; invalid: boolean };

function nativeHome(env: NodeJS.ProcessEnv): string {
  return (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || os.homedir();
}
function configFile(agent: AgentKind, homeDir: string, env: NodeJS.ProcessEnv): string {
  if (agent === 'codex') return path.resolve(env.CODEX_HOME || path.join(homeDir, '.codex'), 'config.toml');
  if (agent === 'claude') return path.resolve(env.CLAUDE_CONFIG_DIR || homeDir, '.claude.json');
  // agy 使用系统用户目录；当前原生版本没有 GEMINI_CLI_HOME/AGY_HOME 覆盖项。
  return path.resolve(homeDir, '.gemini', 'config', 'mcp_config.json');
}
function revisionOf(context: Context, snapshot: Snapshot): string {
  // 把目标路径与服务命令纳入 CAS，避免环境切换后两个 missing 文件共享版本。
  return createHash('sha256')
    .update(JSON.stringify([context.file, snapshot.revision, context.command]))
    .digest('hex');
}
async function readSnapshot(file: string): Promise<Snapshot> {
  const parents = await inspectDirectory(path.dirname(file));
  if (!parents) return { content: '', revision: 'missing' };
  const snapshot = await readConfigFile(file);
  await assertDirectoryUnchanged(parents);
  return snapshot;
}
function entryState(context: Context, snapshot: Snapshot) {
  try {
    const entry = sessionToolsEntry(
      parseSessionToolsConfig(snapshot.content, context.agent === 'codex'),
      context.agent === 'codex',
    );
    const enabled = ownsSessionToolsEntry(entry, context.command);
    return { enabled, conflict: entry !== undefined && !enabled, invalid: false };
  } catch {
    return { enabled: false, conflict: false, invalid: true };
  }
}
function assertWritable(state: State, input: SessionToolsInput) {
  if (state.status.revision !== input.revision) throw new SessionToolsError('revision_conflict');
  if (state.invalid) throw new SessionToolsError('invalid_config');
  if (state.conflict) throw new SessionToolsError('entry_conflict');
  if (!state.status.available) throw new SessionToolsError('unavailable');
}
function anonymousError(error: unknown): never {
  if (error instanceof SessionToolsError || error instanceof FileAccessError) throw error;
  throw new SessionToolsError('io_error');
}

/** 只操作一个固定名字的用户 MCP；不修改原生信任、权限或工具批准设置。 */
export function createSessionToolsService(deps: Deps) {
  const registrationAvailable =
    deps.registrationAvailable ?? !(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
  const command =
    deps.command ?? buildSessionToolsCommand(deps.configDir, deps.homeDir ? { homeDir: deps.homeDir, env: {} } : {});
  const resolveCommand = deps.resolveCommand ?? resolveLocalCommand;
  const run = deps.run ?? runProcess;
  async function contextFor(agent: AgentKind): Promise<Context> {
    const resolved = await deps.environment(agent);
    const env = deps.homeDir ? { ...resolved, HOME: deps.homeDir, USERPROFILE: deps.homeDir } : resolved;
    const homeDir = deps.homeDir ?? nativeHome(env);
    const entry: SessionToolsEntry =
      agent === 'antigravity' ? { ...command, tools: { read_session: { eager: true } } } : command;
    return { agent, env, file: configFile(agent, homeDir, env), command: entry };
  }
  async function load(context: Context): Promise<State> {
    const snapshot = await readSnapshot(context.file);
    const state = entryState(context, snapshot);
    let installed = true;
    try {
      resolveCommand(context.agent === 'antigravity' ? 'agy' : context.agent, context.env);
    } catch {
      installed = false;
    }
    const reason = !registrationAvailable
      ? 'unsupported_runtime'
      : state.invalid
        ? 'invalid_config'
        : state.conflict
          ? 'entry_conflict'
          : !installed
            ? 'unavailable'
            : undefined;
    return {
      snapshot,
      ...state,
      status: {
        agent: context.agent,
        enabled: state.enabled,
        available: !reason,
        revision: revisionOf(context, snapshot),
        ...(reason ? { message: errors[reason][1] } : {}),
      },
    };
  }
  async function writeClaude(context: Context, state: State, enabled: boolean) {
    const parents = await inspectDirectory(path.dirname(context.file), true);
    await assertDirectoryUnchanged(parents!);
    if ((await readConfigFile(context.file)).revision !== state.snapshot.revision)
      throw new SessionToolsError('revision_conflict');
    const cli = resolveCommand('claude', context.env);
    const args = enabled
      ? [
          'mcp',
          'add-json',
          '--scope',
          'user',
          SESSION_TOOLS_NAME,
          JSON.stringify({ type: 'stdio', ...context.command }),
        ]
      : ['mcp', 'remove', '--scope', 'user', SESSION_TOOLS_NAME];
    const result = await run(cli.command, [...cli.args, ...args], {
      env: context.env,
      cwd: path.dirname(context.file),
      timeoutMs: 15_000,
      outputCap: 64 * 1024,
    });
    if (result.exitCode !== 0) throw new SessionToolsError('native_failed');
    await assertDirectoryUnchanged(parents!);
  }
  async function writeFile(context: Context, state: State, enabled: boolean) {
    let content: string;
    try {
      content = editSessionToolsConfig(state.snapshot.content, context.command, {
        toml: context.agent === 'codex',
        enabled,
      });
    } catch {
      throw new SessionToolsError('invalid_config');
    }
    const parents = await inspectDirectory(path.dirname(context.file), true);
    await writeConfigFile(context.file, Buffer.from(content), state.snapshot, parents!);
  }
  async function change(agent: AgentKind, input: SessionToolsInput): Promise<SessionToolsStatus> {
    const context = await contextFor(agent);
    return nativeFileTransaction(context.file, async () => {
      const state = await load(context);
      assertWritable(state, input);
      if (state.status.enabled === input.enabled) return state.status;
      if (agent === 'claude') await writeClaude(context, state, input.enabled);
      else await writeFile(context, state, input.enabled);
      const updated = await load(context);
      if (updated.status.enabled !== input.enabled || updated.conflict) throw new SessionToolsError('native_failed');
      await deps.onSaved?.(agent);
      try {
        await deps.restart?.(agent);
      } catch {
        throw new SessionToolsError('restart_failed');
      }
      return updated.status;
    });
  }
  return {
    async read(agent: AgentKind): Promise<SessionToolsStatus> {
      try {
        return (await load(await contextFor(agent))).status;
      } catch (error) {
        return anonymousError(error);
      }
    },
    async save(agent: AgentKind, input: SessionToolsInput): Promise<SessionToolsStatus> {
      if (!SessionToolsInputSchema.safeParse(input).success) throw new SessionToolsError('invalid_request');
      // 便携版的随机解包路径不能写入长期保留的原生配置，包括尝试清理旧 entry。
      if (!registrationAvailable) throw new SessionToolsError('unsupported_runtime');
      const operation = () => change(agent, input).catch(anonymousError);
      // 锁放在错误转换之外，保留 TurnManager 的明确 agent_busy / 409。
      return deps.withIdleAgent ? deps.withIdleAgent(agent, operation) : operation();
    },
  };
}
export type SessionToolsService = ReturnType<typeof createSessionToolsService>;
