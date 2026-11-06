import {
  TERMINAL_LIMITS,
  TerminalTokenSchema,
  terminalTargetKey,
  workspaceTerminalTarget,
  type TerminalBinding,
  type TerminalTarget,
} from '@agentdeck/shared/ssh';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SshPool } from '../../ssh/pool';
import { boundWorkspace } from '../../../../workspaces/bound';
import type { WorkspaceStore } from '../../../../workspaces/store';
import { TerminalError } from './errors';

export function createTerminalBindings(deps: {
  store: Pick<WorkspaceStore, 'get'>;
  pool: Pick<SshPool, 'fingerprint' | 'generation'>;
  isEnabled?: () => boolean;
}) {
  const secret = randomBytes(32);
  let epoch = 0;
  function assertCurrent(expected = epoch) {
    if (deps.isEnabled?.() === false) throw new TerminalError('plugin_disabled');
    if (expected !== epoch) throw new TerminalError('target_changed');
  }
  async function readTarget(target: TerminalTarget, signal: AbortSignal) {
    assertCurrent();
    const issuedEpoch = epoch;
    signal.throwIfAborted();
    const generation = deps.pool.generation(target.sshHost);
    // 终端只服务已绑定服务器与默认目录的项目；未绑定的项目没有可校验的目标。
    const workspace = boundWorkspace(await deps.store.get(target.workspaceId));
    if (!workspace) throw new TerminalError('workspace_missing');
    if (terminalTargetKey(workspaceTerminalTarget(workspace)) !== terminalTargetKey(target))
      throw new TerminalError('target_changed');
    const fingerprint = await deps.pool.fingerprint(target.sshHost);
    signal.throwIfAborted();
    assertCurrent(issuedEpoch);
    if (generation !== deps.pool.generation(target.sshHost)) throw new TerminalError('target_changed');
    return { workspace, fingerprint, generation, epoch: issuedEpoch };
  }
  const sign = (prefix: string, target: TerminalTarget, identity: { fingerprint: string; generation: number }) =>
    createHmac('sha256', secret)
      .update(JSON.stringify([prefix, terminalTargetKey(target), identity.fingerprint, identity.generation, epoch]))
      .digest('hex');
  function check(
    token: string,
    target: TerminalTarget,
    identity: { fingerprint: string; generation: number },
    expiredAllowed: boolean,
  ) {
    if (!TerminalTokenSchema.safeParse(token).success) throw new TerminalError('invalid_request');
    const parts = token.split('.');
    const prefix = parts.slice(0, 3).join('.');
    const expiresAt = Number(parts[1]);
    if (
      !Number.isSafeInteger(expiresAt) ||
      !timingSafeEqual(Buffer.from(parts[3]!, 'hex'), Buffer.from(sign(prefix, target, identity), 'hex'))
    )
      throw new TerminalError('target_changed');
    if (!expiredAllowed && Date.now() >= expiresAt) throw new TerminalError('binding_expired');
  }
  return {
    invalidate() {
      epoch++;
    },
    async issue(
      target: TerminalTarget,
      options: { signal: AbortSignal; previousBinding?: string },
    ): Promise<TerminalBinding> {
      const identity = await readTarget(target, options.signal);
      assertCurrent(identity.epoch);
      if (options.previousBinding) check(options.previousBinding, target, identity, true);
      const expiresAt = Date.now() + TERMINAL_LIMITS.bindingMs;
      const prefix = `1.${expiresAt}.${randomBytes(16).toString('hex')}`;
      return { target, expiresAt, binding: `${prefix}.${sign(prefix, target, identity)}` };
    },
    async verify(target: TerminalTarget, binding: string, signal: AbortSignal) {
      const identity = await readTarget(target, signal);
      assertCurrent(identity.epoch);
      check(binding, target, identity, false);
      return { workspace: identity.workspace, fingerprint: identity.fingerprint, generation: identity.generation };
    },
  };
}
export type TerminalBindings = ReturnType<typeof createTerminalBindings>;
