import { createHash, randomUUID } from 'node:crypto';
import type { AgentKind } from '@agentdeck/shared/conversation';
import type { CliInstallInput, CliInstallationStatus } from '@agentdeck/shared/settings';
import type { CliInstallation, CliInstallationBackend } from './types';
import { CliInstallationError, installationFailure } from './service-errors';

type Deps = {
  backend: CliInstallationBackend;
  withIdleAgent<T>(agent: AgentKind, operation: () => Promise<T>): Promise<T>;
  restart(agent: AgentKind): Promise<void>;
  onChanged(agent: AgentKind): Promise<void>;
  verify?(agent: AgentKind): Promise<boolean>;
  now?: () => number;
};
export type CliInstallationService = {
  read(agent: AgentKind): Promise<CliInstallationStatus>;
  check(agent: AgentKind): Promise<CliInstallationStatus>;
  start(agent: AgentKind, input: CliInstallInput): Promise<CliInstallationStatus>;
  dispose(): Promise<void>;
};
type Release = { version: string; checkedAt: number; fingerprint: string };
type Entry = {
  installation?: CliInstallation;
  release?: Release;
  phase: CliInstallationStatus['phase'];
  operationId: string | null;
  message: string | null;
  reading?: Promise<CliInstallationStatus>;
  checking?: Promise<CliInstallationStatus>;
};
type Operation = {
  agent: AgentKind;
  entry: Entry;
  controller: AbortController;
  accepted: boolean;
};
const RELEASE_TTL = 15 * 60 * 1_000;

function fingerprint(installation: CliInstallation): string {
  const { installed, version, source, identity, command, prefix, npm, channel, canInstall, canUpdate } = installation;
  return createHash('sha256')
    .update(
      JSON.stringify({ installed, version, source, identity, command, prefix, npm, channel, canInstall, canUpdate }),
    )
    .digest('hex');
}

function matchingRelease(entry: Entry): Release | undefined {
  if (entry.installation && entry.release?.fingerprint === fingerprint(entry.installation)) return entry.release;
  return undefined;
}

function revision(entry: Entry): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        installation: entry.installation && fingerprint(entry.installation),
        latest: matchingRelease(entry)?.version,
      }),
    )
    .digest('hex');
}

function compareIdentifier(left: string, right: string): number {
  if (left === right) return 0;
  const numbers = [left, right].map((part) => /^\d+$/.test(part));
  if (numbers[0] && numbers[1]) return Number(left) - Number(right);
  if (numbers[0] !== numbers[1]) return numbers[0] ? -1 : 1;
  return left < right ? -1 : 1;
}

function comparePrerelease(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const a = left.split('.');
  const b = right.split('.');
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    const result = compareIdentifier(a[index]!, b[index]!);
    if (result !== 0) return result;
  }
  return 0;
}

function compareVersions(left: string | null, right: string | null): number | null {
  const pattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
  const a = left?.match(pattern);
  const b = right?.match(pattern);
  if (!a || !b) return null;
  for (let index = 1; index <= 3; index++) {
    const result = Number(a[index]) - Number(b[index]);
    if (!Number.isSafeInteger(result)) return null;
    if (result !== 0) return result;
  }
  return comparePrerelease(a[4], b[4]);
}

function normalizePath(value: string | undefined): string | undefined {
  return process.platform === 'win32' ? value?.replaceAll('\\', '/').toLowerCase() : value;
}

function origin(installation: CliInstallation): string {
  const command = installation.command;
  return JSON.stringify({
    source: installation.source,
    prefix: normalizePath(installation.prefix),
    channel: installation.channel,
    command: normalizePath(command?.command),
    args: command?.args.map((arg) => (/[/\\]/.test(arg) ? normalizePath(arg) : arg)),
  });
}

function validateResult(before: CliInstallation, after: CliInstallation, target: string): void {
  const targetComparison = compareVersions(after.version, target);
  const currentComparison = before.version === null ? 0 : compareVersions(after.version, before.version);
  if (!after.installed || targetComparison === null || targetComparison < 0)
    throw new CliInstallationError('verification_failed');
  if (currentComparison === null || currentComparison < 0) throw new CliInstallationError('verification_failed');
  validateOrigin(before, after);
}

function validateOrigin(before: CliInstallation, after: CliInstallation): void {
  if (before.installed && origin(before) !== origin(after)) throw new CliInstallationError('verification_failed');
  if (before.prefix && normalizePath(before.prefix) !== normalizePath(after.prefix))
    throw new CliInstallationError('verification_failed');
}

function canUpdate(installation: CliInstallation, latest: string | null): boolean {
  if (!installation.installed || !installation.canUpdate) return false;
  if (installation.version === null) return true;
  const comparison = compareVersions(latest, installation.version);
  return comparison !== null && comparison > 0;
}

function validateAction(installation: CliInstallation, action: CliInstallInput['action'], target: string): void {
  const permitted =
    action === 'install'
      ? !installation.installed && installation.canInstall
      : installation.installed && installation.canUpdate;
  if (!permitted) throw new CliInstallationError('unsupported');
  if (action === 'update' && !canUpdate(installation, target)) throw new CliInstallationError('check_required');
}

class InstallationService implements CliInstallationService {
  private readonly entries = new Map<AgentKind, Entry>();
  private readonly controllers = new Set<AbortController>();
  private readonly pending = new Set<Promise<unknown>>();
  private active?: Operation;
  private closed = false;
  private readonly now: () => number;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now;
  }

  private assertOpen(): void {
    if (this.closed) throw new CliInstallationError('service_closed');
  }

  private entry(agent: AgentKind): Entry {
    let entry = this.entries.get(agent);
    if (!entry) {
      entry = { phase: 'idle', operationId: null, message: null };
      this.entries.set(agent, entry);
    }
    return entry;
  }

  private track<T>(task: Promise<T>, controller: AbortController): Promise<T> {
    this.controllers.add(controller);
    this.pending.add(task);
    const complete = () => {
      this.controllers.delete(controller);
      this.pending.delete(task);
    };
    void task.then(complete, complete);
    return task;
  }

  private fresh(release: Release | undefined): boolean {
    if (!release) return false;
    const age = this.now() - release.checkedAt;
    return age >= 0 && age <= RELEASE_TTL;
  }

  private status(entry: Entry): CliInstallationStatus {
    const installation = entry.installation;
    if (!installation) throw new CliInstallationError('internal_error');
    const release = matchingRelease(entry);
    const latestVersion = release?.version ?? null;
    return {
      agent: installation.agent,
      installed: installation.installed,
      currentVersion: installation.version,
      latestVersion,
      source: installation.source,
      ...this.actions(entry, release),
      checkedAt: release?.checkedAt ?? null,
      revision: revision(entry),
      phase: entry.phase,
      operationId: entry.operationId,
      message: entry.message ?? installation.message,
      guideUrl: installation.guideUrl,
    };
  }

  private actions(entry: Entry, release: Release | undefined) {
    const installation = entry.installation!;
    const latestVersion = release?.version ?? null;
    const comparison = compareVersions(latestVersion, installation.version);
    const idle = !this.active && entry.phase !== 'checking';
    return {
      updateAvailable: comparison !== null && comparison > 0,
      canInstall: idle && !installation.installed && installation.canInstall,
      canUpdate: idle && this.fresh(release) && canUpdate(installation, latestVersion),
    };
  }

  async read(agent: AgentKind): Promise<CliInstallationStatus> {
    this.assertOpen();
    const entry = this.entry(agent);
    if (entry.installation && (this.active?.agent === agent || entry.checking)) return this.status(entry);
    if (entry.checking) return entry.checking;
    if (entry.reading) return entry.reading;
    const controller = new AbortController();
    const task = this.refresh(entry, agent, controller.signal)
      .then(() => this.status(entry))
      .catch((error: unknown) => {
        throw installationFailure(error);
      })
      .finally(() => {
        entry.reading = undefined;
      });
    entry.reading = this.track(task, controller);
    return task;
  }

  private async refresh(entry: Entry, agent: AgentKind, signal: AbortSignal): Promise<void> {
    entry.installation = await this.deps.backend.inspect(agent, signal);
  }

  async check(agent: AgentKind): Promise<CliInstallationStatus> {
    this.assertOpen();
    const entry = this.entry(agent);
    if (this.active?.agent === agent) return this.status(entry);
    if (entry.checking) return entry.checking;
    const controller = new AbortController();
    const task = this.checkLatest(entry, agent, controller.signal).finally(() => {
      entry.checking = undefined;
    });
    entry.checking = this.track(task, controller);
    return task;
  }

  private async checkLatest(entry: Entry, agent: AgentKind, signal: AbortSignal): Promise<CliInstallationStatus> {
    try {
      await entry.reading;
      entry.phase = 'checking';
      entry.message = null;
      entry.operationId = null;
      await this.refresh(entry, agent, signal);
      const initial = fingerprint(entry.installation!);
      const release = await this.deps.backend.latest(entry.installation!, signal);
      await this.refresh(entry, agent, signal);
      signal.throwIfAborted();
      if (fingerprint(entry.installation!) !== initial) throw new CliInstallationError('revision_conflict');
      if (compareVersions(release.version, release.version) === null) throw new CliInstallationError('check_failed');
      entry.release = { ...release, checkedAt: this.now(), fingerprint: initial };
      entry.phase = 'idle';
    } catch (error) {
      entry.release = undefined;
      entry.phase = 'failed';
      entry.message = installationFailure(error, 'check_failed').message;
      if (!entry.installation) throw installationFailure(error, 'check_failed');
    }
    return this.status(entry);
  }

  async start(agent: AgentKind, input: CliInstallInput): Promise<CliInstallationStatus> {
    this.assertOpen();
    if (this.active) throw new CliInstallationError('installation_busy');
    const entry = this.entry(agent);
    if (!entry.installation || !entry.release) throw new CliInstallationError('check_required');
    const operation: Operation = { agent, entry, controller: new AbortController(), accepted: false };
    this.active = operation;
    let accept!: (status: CliInstallationStatus) => void;
    let reject!: (error: unknown) => void;
    const accepted = new Promise<CliInstallationStatus>((resolve, fail) => {
      accept = resolve;
      reject = fail;
    });
    const task = Promise.resolve()
      .then(() =>
        this.deps.withIdleAgent(agent, async () => {
          const installation = await this.prepare(operation, input);
          entry.phase = input.action === 'install' ? 'installing' : 'updating';
          entry.operationId = randomUUID();
          entry.message = null;
          operation.accepted = true;
          accept(this.status(entry));
          await this.perform(operation, installation, entry.release!.version);
        }),
      )
      .catch((error: unknown) => {
        const failure = installationFailure(error, 'install_failed');
        if (operation.accepted) {
          entry.phase = 'failed';
          entry.message = failure.message;
        }
        reject(failure);
      })
      .finally(() => {
        this.active = undefined;
      });
    void this.track(task, operation.controller);
    return accepted;
  }

  private async prepare(operation: Operation, input: CliInstallInput): Promise<CliInstallation> {
    const { entry, agent, controller } = operation;
    await entry.reading;
    await entry.checking;
    controller.signal.throwIfAborted();
    if (revision(entry) !== input.revision) throw new CliInstallationError('revision_conflict');
    if (!this.fresh(matchingRelease(entry))) throw new CliInstallationError('check_required');
    await this.refresh(entry, agent, controller.signal);
    if (revision(entry) !== input.revision) throw new CliInstallationError('revision_conflict');
    const installation = entry.installation!;
    validateAction(installation, input.action, entry.release!.version);
    controller.signal.throwIfAborted();
    return installation;
  }

  private async perform(operation: Operation, installation: CliInstallation, target: string): Promise<void> {
    const { entry, agent, controller } = operation;
    let failure: CliInstallationError | undefined;
    try {
      await this.deps.restart(agent);
      controller.signal.throwIfAborted();
      await this.deps.backend.execute(installation, target, controller.signal);
      entry.phase = 'verifying';
      await this.refresh(entry, agent, controller.signal);
      controller.signal.throwIfAborted();
      validateResult(installation, entry.installation!, target);
      if (this.deps.verify && !(await this.deps.verify(agent))) throw new CliInstallationError('incompatible');
      controller.signal.throwIfAborted();
    } catch (error) {
      failure = installationFailure(error, 'install_failed');
    }
    failure = await this.finish(operation, failure);
    entry.phase = failure ? 'failed' : 'succeeded';
    entry.message = failure?.message ?? 'CLI 安装已验证完成';
  }

  private async finish(
    operation: Operation,
    failure: CliInstallationError | undefined,
  ): Promise<CliInstallationError | undefined> {
    const { entry, agent, controller } = operation;
    entry.release = undefined;
    try {
      await this.deps.onChanged(agent);
    } catch (error) {
      failure ??= installationFailure(error, 'install_failed');
    }
    // 即使安装进程部分失败，也重新读取本机状态；退出时沿用已取消信号，避免启动新进程。
    if (failure) {
      try {
        await this.refresh(entry, agent, controller.signal);
      } catch {
        /* 保留最后一次已知安装信息，错误正文不能进入状态。 */
      }
    }
    return failure;
  }

  async dispose(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.pending]);
  }
}

export function createCliInstallationService(deps: Deps): CliInstallationService {
  return new InstallationService(deps);
}
