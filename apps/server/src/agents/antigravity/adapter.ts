import { antigravityPermissionArgs } from './permissions';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import type { AgentTurnInput, TurnHandle, TurnRunner } from '../contracts';
import { resolveLocalCommand } from '../../platform/process/executable';
import { AntigravityMapper } from './mapper';
import { AntigravityLines } from './lines';
import { antigravityDefaultModel } from './model-catalog';
import { AntigravityInvocationError, antigravityInvocationText } from './commands';
import { antigravityDiagnostic } from './diagnostics';
import type { AgentEvent } from '@agentdeck/shared/conversation';

export type AntigravityProcess = Pick<
  ChildProcessWithoutNullStreams,
  'stdin' | 'stdout' | 'stderr' | 'kill' | 'on' | 'once'
>;
type LaunchInput = { cwd: string; args: string[]; env?: NodeJS.ProcessEnv };
type Options = {
  launch?: (input: LaunchInput) => AntigravityProcess;
  env?: NodeJS.ProcessEnv;
  defaultModel?: () => Promise<string | undefined>;
  invocationText?: (input: AgentTurnInput, signal: AbortSignal) => Promise<string>;
};

function launch(input: LaunchInput): AntigravityProcess {
  const executable = resolveLocalCommand('agy', input.env ?? process.env);
  return spawn(executable.command, [...executable.args, ...input.args], {
    cwd: input.cwd,
    env: input.env,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
function argumentsFor(input: AgentTurnInput): string[] {
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json'];
  if (input.sessionId) args.push('--conversation', input.sessionId);
  if (input.model) args.push('--model', input.model);
  if (input.reasoningEffort) args.push('--effort', input.reasoningEffort);
  args.push(...antigravityPermissionArgs(input.permission));
  return args;
}

/** 每轮关闭 stdin，下一轮以原生 id 续接；不保存第二份会话正文。 */
class AntigravityTurn {
  readonly done: Promise<void>;
  private settle!: () => void;
  private readonly mapper: AntigravityMapper;
  private readonly stdout: AntigravityLines;
  private readonly stderr: AntigravityLines;
  private child?: AntigravityProcess;
  private timer?: NodeJS.Timeout;
  private ended = false;
  private failed = false;
  private readonly notices = new Set<string>();
  private reportedError = false;
  private nativeFailure = false;
  /** 原生结果已经确认时，进程清理与模型回合成功是两个独立状态。 */
  private closingAfterResult = false;
  private cleanupSignalSent = false;
  private readonly preparation = new AbortController();

  constructor(
    private readonly input: AgentTurnInput,
    start: (input: LaunchInput) => AntigravityProcess,
    defaultModel: () => Promise<string | undefined>,
    invocationText: (input: AgentTurnInput, signal: AbortSignal) => Promise<string>,
  ) {
    this.done = new Promise((resolve) => {
      this.settle = resolve;
    });
    this.mapper = new AntigravityMapper(input.workspace.dir, input.sessionId);
    this.stdout = new AntigravityLines((line) => this.message(line));
    this.stderr = new AntigravityLines((line) => this.diagnostic(line), 65_536);
    void this.start(start, defaultModel, invocationText);
  }

  private async start(
    start: (input: LaunchInput) => AntigravityProcess,
    defaultModel: () => Promise<string | undefined>,
    invocationText: (input: AgentTurnInput, signal: AbortSignal) => Promise<string>,
  ) {
    try {
      const text = this.input.invocation ? await invocationText(this.input, this.preparation.signal) : this.input.text;
      const model = this.input.model ?? (await defaultModel());
      if (this.ended || this.failed) return;
      this.child = start({ cwd: this.input.workspace.dir, args: argumentsFor({ ...this.input, model }) });
      this.listen(this.child);
      this.timer = setTimeout(() => this.fail('Antigravity 启动超时，请检查本机登录与配置。'), 30_000);
      this.child.stdin.end(`${JSON.stringify({ event: 'user', message: { content: text } })}\n`);
    } catch (error) {
      this.fail(
        error instanceof AntigravityInvocationError
          ? error.message
          : '无法启动 Antigravity，请检查本机 agy 安装与启动环境。',
      );
      if (!this.child) this.finish(null);
    }
  }

  interrupt(): Promise<void> {
    if (!this.ended) {
      this.failed = true;
      this.preparation.abort();
      if (this.child) this.stop();
      else this.finish(null);
    }
    return this.done;
  }

  private listen(child: AntigravityProcess): void {
    child.stdout.on('data', (chunk: Buffer) => this.consume(this.stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => this.consume(this.stderr, chunk));
    child.stdin.on('error', () => this.fail('Antigravity 未接收本轮输入。'));
    child.once('error', () => this.fail('Antigravity 进程启动失败，请检查安装与执行路径。'));
    child.once('close', (code: number | null) => this.finish(code));
  }

  private consume(lines: AntigravityLines, chunk: Buffer): void {
    if (this.ended || this.failed) return;
    try {
      lines.push(chunk);
    } catch {
      this.fail('Antigravity 输出格式异常或超限，已停止本轮。');
    }
  }

  private message(line: string): void {
    if (this.ended || this.failed) return;
    const value: unknown = JSON.parse(line);
    const events = this.mapper.map(value);
    if (events.some((event) => event.type === 'session') || this.mapper.result) clearTimeout(this.timer);
    for (const event of events) {
      if (event.type === 'error') this.notice(event);
      else this.input.emit(event);
    }
    if (this.mapper.result)
      this.timer = setTimeout(() => {
        this.closingAfterResult = true;
        this.stop();
      }, 2_000);
  }

  private diagnostic(line: string): void {
    const event = antigravityDiagnostic(line);
    this.nativeFailure ||=
      event?.type === 'error' || /^(?:error\s*:|AGY_ERROR\s*:)/i.test(stripVTControlCharacters(line).trim());
    if (event) this.notice(event);
  }

  private notice(event: Extract<AgentEvent, { type: 'error' | 'activity' }>): void {
    const key = event.type === 'error' ? event.message : event.id;
    if (this.notices.has(key)) return;
    this.notices.add(key);
    if (event.type === 'error') this.reportedError = true;
    this.input.emit(event);
  }

  private fail(message: string): void {
    if (this.ended || this.failed) return;
    this.failed = true;
    this.notice({ type: 'error', message });
    this.stop();
  }

  private stop(): void {
    clearTimeout(this.timer);
    this.kill('SIGTERM');
    this.timer = setTimeout(() => {
      this.kill('SIGKILL');
      // kill 只表示信号已发送，真实 close 才能释放会话占用与活动实例。
    }, 2_000);
  }

  private kill(signal: NodeJS.Signals): void {
    const sent = this.child?.kill(signal);
    if (sent && this.closingAfterResult) this.cleanupSignalSent = true;
  }

  private abnormalExit(code: number | null): boolean {
    return code !== 0 && !this.cleanupSignalSent;
  }

  private flushOutput(): void {
    if (this.failed) return;
    try {
      this.stdout.end();
      this.stderr.end();
    } catch {
      this.failed = true;
      this.notice({ type: 'error', message: 'Antigravity 结束时返回了不完整的协议数据。' });
    }
  }

  private finish(code: number | null): void {
    if (this.ended) return;
    this.flushOutput();
    this.ended = true;
    clearTimeout(this.timer);
    this.completeResult(code);
    const result = this.mapper.result;
    const isError = this.failed || !result || result.isError || this.abnormalExit(code);
    // stdout 与 stderr 顺序不固定；排空后才兜底，避免覆盖稍后到达的具体原因。
    if (!this.failed && !this.reportedError && isError)
      this.notice({
        type: 'error',
        message: result
          ? 'Antigravity 未成功完成本轮，请检查原生 CLI 的运行状态与配置。'
          : 'Antigravity 在返回完整结果前退出，请重新读取原生会话后核对。',
      });
    this.input.emit({
      ...(result ?? { type: 'turn_end' as const }),
      isError,
    });
    this.settle();
  }

  private completeResult(code: number | null): void {
    const naturalSuccess = code === 0 && !this.failed && !this.cleanupSignalSent && !this.nativeFailure;
    for (const event of this.mapper.complete(naturalSuccess)) this.notice(event);
  }
}

export function createAntigravityRunner(options: Options = {}): TurnRunner {
  const active = new Set<AntigravityTurn>();
  const runner: TurnRunner = (input): TurnHandle => {
    const turn = new AntigravityTurn(
      input,
      (request) => (options.launch ?? launch)({ ...request, ...(options.env ? { env: options.env } : {}) }),
      options.defaultModel ?? (() => antigravityDefaultModel(options.env ?? process.env)),
      options.invocationText ?? ((input, signal) => antigravityInvocationText(input, { env: options.env, signal })),
    );
    active.add(turn);
    return { interrupt: () => turn.interrupt(), done: turn.done.finally(() => active.delete(turn)) };
  };
  runner.dispose = async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([...active].map((turn) => turn.interrupt())),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 2_100);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  return runner;
}
