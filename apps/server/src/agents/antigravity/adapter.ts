import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgentTurnInput, TurnHandle, TurnRunner } from '../types';
import { resolveLocalCommand } from '../../process/executable';
import { AntigravityMapper } from './mapper';
import { AntigravityLines } from './lines';

export type AntigravityProcess = Pick<
  ChildProcessWithoutNullStreams,
  'stdin' | 'stdout' | 'stderr' | 'kill' | 'on' | 'once'
>;
type LaunchInput = { cwd: string; args: string[] };
type Options = { launch?: (input: LaunchInput) => AntigravityProcess };

function launch(input: LaunchInput): AntigravityProcess {
  const executable = resolveLocalCommand('agy', process.env);
  return spawn(executable.command, [...executable.args, ...input.args], {
    cwd: input.cwd,
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
  private permissionNotice = false;
  private diagnosticNotice = false;

  constructor(
    private readonly input: AgentTurnInput,
    start: (input: LaunchInput) => AntigravityProcess,
  ) {
    this.done = new Promise((resolve) => {
      this.settle = resolve;
    });
    this.mapper = new AntigravityMapper(input.workspace.dir, input.sessionId);
    this.stdout = new AntigravityLines((line) => this.message(line));
    this.stderr = new AntigravityLines((line) => this.diagnostic(line), 65_536);
    try {
      if (input.invocation) throw new Error('不支持此调用');
      this.child = start({ cwd: input.workspace.dir, args: argumentsFor(input) });
      this.listen(this.child);
      this.timer = setTimeout(() => this.fail('Antigravity 启动超时，请检查本机登录与配置。'), 30_000);
      this.child.stdin.end(`${JSON.stringify({ event: 'user', message: { content: input.text } })}\n`);
    } catch {
      this.fail('无法启动 Antigravity，请检查本机 agy 安装与启动环境。');
      if (!this.child) this.finish(null);
    }
  }

  interrupt(): Promise<void> {
    if (!this.ended) {
      this.failed = true;
      this.stop();
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
    for (const event of events) this.input.emit(event);
    if (this.mapper.result)
      this.timer = setTimeout(() => {
        this.fail('Antigravity 已返回结果但进程退出未确认，正在请求停止；退出前保持当前会话占用。');
      }, 2_000);
  }

  private diagnostic(line: string): void {
    const permission = /soft.den|permission|approval|权限|拒绝/i.test(line);
    if (permission && !this.permissionNotice) {
      this.permissionNotice = true;
      const tool = /\btool\s+([a-zA-Z_][a-zA-Z0-9_]{0,79})\b/.exec(line)?.[1];
      this.input.emit({
        type: 'error',
        message: `Antigravity 报告了权限限制${tool ? `（${tool}）` : ''}：需要确认的工具可能被软拒绝。请检查原生 permissions 规则，本应用不会自动放行。`,
      });
    } else if (!permission && !this.diagnosticNotice) {
      this.diagnosticNotice = true;
      this.input.emit({
        type: 'error',
        message: 'Antigravity 返回了运行诊断；若未完成操作，请检查原生登录、模型与配置。诊断原文不回传以避免暴露凭据。',
      });
    }
  }

  private fail(message: string): void {
    if (this.ended || this.failed) return;
    this.failed = true;
    this.input.emit({ type: 'error', message });
    this.stop();
  }

  private stop(): void {
    clearTimeout(this.timer);
    this.child?.kill('SIGTERM');
    this.timer = setTimeout(() => {
      this.child?.kill('SIGKILL');
      // kill 只表示信号已发送，真实 close 才能释放会话占用与活动实例。
    }, 2_000);
  }

  private finish(code: number | null): void {
    if (this.ended) return;
    if (!this.failed) {
      try {
        this.stdout.end();
        this.stderr.end();
      } catch {
        this.failed = true;
        this.input.emit({ type: 'error', message: 'Antigravity 结束时返回了不完整的协议数据。' });
      }
    }
    this.ended = true;
    clearTimeout(this.timer);
    const result = this.mapper.result;
    if (!result && !this.failed)
      this.input.emit({ type: 'error', message: 'Antigravity 在返回完整结果前退出，请重新读取原生会话后核对。' });
    this.input.emit({
      ...(result ?? { type: 'turn_end' as const }),
      isError: this.failed || !result || result.isError || code !== 0,
    });
    this.settle();
  }
}

export function createAntigravityRunner(options: Options = {}): TurnRunner {
  const active = new Set<AntigravityTurn>();
  const runner: TurnRunner = (input): TurnHandle => {
    const turn = new AntigravityTurn(input, options.launch ?? launch);
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
