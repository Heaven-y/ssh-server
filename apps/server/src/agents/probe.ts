// 第一层本机探测：只跑 --version、--help 与 Codex 的本地 schema 生成。
// 不读能力目录、不检查账号、不向任何模型端点发请求；每个 CLI 独立判定四态。
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentKind, AgentProbe } from '@agentdeck/shared';
import { ProcessError, runProcess, type ProcessRunner } from '../process/run';
import { resolveLocalCommand } from '../process/executable';

const PROBE_TIMEOUT_MS = 5_000;
const VERSION_OUTPUT_CAP = 64 * 1024;
const HELP_OUTPUT_CAP = 256 * 1024;
const SCHEMA_OUTPUT_CAP = 1024 * 1024;
const AGENT_ORDER: AgentKind[] = ['claude', 'codex', 'antigravity'];

type AgentSpec = {
  agent: AgentKind;
  executable: string;
  version?: RegExp;
  /** --help 里必须出现的选项或子命令；缺一项即视为接口变化。 */
  requiredHelp: string[];
  /** Codex 用 app-server generate-json-schema 验证 RPC 协议，必须生成有效 JSON。 */
  schema?: boolean;
};

const SPECS: Record<AgentKind, AgentSpec> = {
  claude: {
    agent: 'claude',
    executable: 'claude',
    version: /^(\d+\.\d+\.\d+)\s+\(Claude Code\)/m,
    requiredHelp: ['--print', '--input-format', '--output-format', '--permission-prompts'],
  },
  codex: {
    agent: 'codex',
    executable: 'codex',
    version: /codex-cli (\d+\.\d+\.\d+)/,
    requiredHelp: ['app-server'],
    schema: true,
  },
  antigravity: {
    agent: 'antigravity',
    executable: 'agy',
    requiredHelp: ['--print', '--input-format', '--output-format', '--conversation'],
  },
};

type MissingReason = 'not-found' | 'timeout' | 'aborted';
type MissingStep = { kind: 'missing'; reason: MissingReason };
type ChangedStep = { kind: 'changed'; missing: string[]; detail: string };
type StepFailure = MissingStep | ChangedStep;
type VersionStep = { kind: 'ok'; version?: string } | StepFailure;
type OutputStep = { kind: 'ok'; stdout: string; stderr: string } | StepFailure;
type SchemaStep = { kind: 'ok' } | StepFailure;

const MISSING_HINTS: Record<MissingReason, string> = {
  'not-found': '未找到或无法启动',
  timeout: '探测超时（5 秒）',
  aborted: '探测已取消',
};

/** 固定探测目标，界面显示的版本就是这里实际运行的程序版本。 */
export function createLocalRunner(env: () => NodeJS.ProcessEnv = () => process.env): ProcessRunner {
  return async (command, args, options) => {
    const currentEnv = env();
    const resolved =
      command === 'claude' || command === 'codex' || command === 'agy'
        ? resolveLocalCommand(command, currentEnv)
        : { command, args: [] };
    return runProcess(resolved.command, [...resolved.args, ...args], { ...options, env: options.env ?? currentEnv });
  };
}

function normalizeOutput(output: Buffer): string {
  return output.toString('utf8').replace(/^\uFEFF/, '');
}

function classifyRunFailure(error: unknown, capability: string): StepFailure {
  if (error instanceof ProcessError) {
    if (error.code === 'timeout') return { kind: 'missing', reason: 'timeout' };
    if (error.code === 'aborted') return { kind: 'missing', reason: 'aborted' };
    if (error.code === 'executable_missing') return { kind: 'missing', reason: 'not-found' };
  }
  return { kind: 'changed', missing: [capability], detail: `${capability} 执行失败` };
}

type AttemptOptions = { command: string; args: string[]; outputCap: number; capability: string };

async function attempt(run: ProcessRunner, options: AttemptOptions): Promise<OutputStep> {
  try {
    const result = await run(options.command, options.args, {
      timeoutMs: PROBE_TIMEOUT_MS,
      outputCap: options.outputCap,
    });
    if (result.exitCode !== 0)
      return { kind: 'changed', missing: [options.capability], detail: `${options.capability} 以非零状态退出` };
    return { kind: 'ok', stdout: normalizeOutput(result.stdout), stderr: normalizeOutput(result.stderr) };
  } catch (error) {
    return classifyRunFailure(error, options.capability);
  }
}

async function readVersion(spec: AgentSpec, run: ProcessRunner): Promise<VersionStep> {
  // agy 未公开版本入口；仅核对已公布的 --help，不把版本缺失等同协议变化。
  if (!spec.version) return { kind: 'ok' };
  const step = await attempt(run, {
    command: spec.executable,
    args: ['--version'],
    outputCap: VERSION_OUTPUT_CAP,
    capability: '--version',
  });
  if (step.kind !== 'ok') return step;
  const version = `${step.stdout}\n${step.stderr}`.match(spec.version)?.[1];
  if (!version) return { kind: 'changed', missing: ['--version'], detail: '无法从 --version 的输出解析版本号' };
  return { kind: 'ok', version };
}

function readHelp(spec: AgentSpec, run: ProcessRunner): Promise<OutputStep> {
  return attempt(run, {
    command: spec.executable,
    args: ['--help'],
    outputCap: HELP_OUTPUT_CAP,
    capability: '--help',
  });
}

function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

async function schemaFilesContainJson(dir: string): Promise<boolean> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return false;
  }
  for (const name of names.filter((entry) => entry.toLowerCase().endsWith('.json'))) {
    try {
      if (isJsonObject(await readFile(path.join(dir, name), 'utf8'))) return true;
    } catch {
      /* 读不了的 schema 文件按未生成处理，不把内容带进报告。 */
    }
  }
  return false;
}

async function readSchema(spec: AgentSpec, run: ProcessRunner): Promise<SchemaStep> {
  let dir: string;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'agentdeck-codex-schema-'));
  } catch {
    return { kind: 'changed', missing: ['generate-json-schema'], detail: '无法创建临时目录' };
  }
  try {
    const step = await attempt(run, {
      command: spec.executable,
      args: ['app-server', 'generate-json-schema', '--out', dir],
      outputCap: SCHEMA_OUTPUT_CAP,
      capability: 'generate-json-schema',
    });
    if (step.kind !== 'ok') return step;
    const stdout = step.stdout.trim();
    if (stdout && isJsonObject(stdout)) return { kind: 'ok' };
    if (await schemaFilesContainJson(dir)) return { kind: 'ok' };
    return {
      kind: 'changed',
      missing: ['generate-json-schema'],
      detail: 'app-server generate-json-schema 没有生成有效的 JSON',
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function hasToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w-])${escaped}(?![\\w-])`).test(text);
}

function missingProbe(spec: AgentSpec, reason: MissingReason, version?: string): AgentProbe {
  return {
    agent: spec.agent,
    status: 'missing',
    ...(version ? { version } : {}),
    message: `可执行文件 ${spec.executable} ${MISSING_HINTS[reason]}；请确认已安装，并检查应用启动时继承的 PATH（安装后需要重启应用），或改用显式可执行文件路径。`,
  };
}

function changedProbe(spec: AgentSpec, version: string | undefined, failure: ChangedStep): AgentProbe {
  return {
    agent: spec.agent,
    status: 'changed',
    ...(version ? { version } : {}),
    missing: failure.missing,
    message: `${spec.executable} 已安装${version ? `（版本 ${version}）` : ''}，但${failure.detail}；接口可能已变化。`,
  };
}

export type AgentProbes = {
  probe(agent: AgentKind): Promise<AgentProbe>;
  probeAll(): Promise<AgentProbe[]>;
};

export type AgentProbeDeps = { run: ProcessRunner; env?: () => NodeJS.ProcessEnv };

export function createAgentProbes(deps: AgentProbeDeps): AgentProbes {
  const run = deps.run;

  async function probe(agent: AgentKind): Promise<AgentProbe> {
    const spec = SPECS[agent];
    const versionStep = await readVersion(spec, run);
    if (versionStep.kind === 'missing') return missingProbe(spec, versionStep.reason);
    if (versionStep.kind === 'changed') return changedProbe(spec, undefined, versionStep);
    const version = versionStep.version;

    const helpStep = await readHelp(spec, run);
    if (helpStep.kind === 'missing') return missingProbe(spec, helpStep.reason, version);
    if (helpStep.kind === 'changed') return changedProbe(spec, version, helpStep);
    // 有的 CLI（实测 agy）把 --help 写到 stderr；能力核对要合并两路输出。
    const helpText = `${helpStep.stdout}\n${helpStep.stderr}`;
    const absentHelp = spec.requiredHelp.filter((item) => !hasToken(helpText, item));
    if (absentHelp.length > 0)
      return changedProbe(spec, version, {
        kind: 'changed',
        missing: absentHelp,
        detail: `--help 缺少 ${absentHelp.join('、')}`,
      });

    if (spec.schema) {
      const schemaStep = await readSchema(spec, run);
      if (schemaStep.kind === 'missing') return missingProbe(spec, schemaStep.reason, version);
      if (schemaStep.kind === 'changed') return changedProbe(spec, version, schemaStep);
    }

    return { agent, status: 'available', ...(version ? { version } : {}) };
  }

  async function probeAll(): Promise<AgentProbe[]> {
    return Promise.all(
      AGENT_ORDER.map(async (agent) => {
        try {
          return await probe(agent);
        } catch {
          // 一个 CLI 的意外失败不拖垮另外两个，也不回传内部输出。
          return {
            agent,
            status: 'missing' as const,
            message: `可执行文件 ${SPECS[agent].executable} 探测失败；请检查本机安装。`,
          };
        }
      }),
    );
  }

  return { probe, probeAll };
}
