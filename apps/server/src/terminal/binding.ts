import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  TERMINAL_LIMITS,
  TerminalTokenSchema,
  terminalTargetKey,
  workspaceTerminalTarget,
  type TerminalTarget,
  type TerminalBinding,
} from '@ssh-server/shared';
import type { WorkspaceStore } from '../workspaces/store';
import type { SshPool } from '../ssh/pool';
import { TerminalError } from './errors';

export function createTerminalBindings(deps: {
  store: Pick<WorkspaceStore, 'get'>;
  pool: Pick<SshPool, 'fingerprint' | 'generation'>;
}) {
  const secret = randomBytes(32);
  async function readTarget(target: TerminalTarget, signal: AbortSignal) {
    signal.throwIfAborted();
    const generation = deps.pool.generation(target.sshHost);
    const workspace = await deps.store.get(target.workspaceId);
    if (!workspace) throw new TerminalError('workspace_missing');
    if (terminalTargetKey(workspaceTerminalTarget(workspace)) !== terminalTargetKey(target))
      throw new TerminalError('target_changed');
    const fingerprint = await deps.pool.fingerprint(target.sshHost, target.authMode);
    signal.throwIfAborted();
    if (generation !== deps.pool.generation(target.sshHost)) throw new TerminalError('target_changed');
    return { workspace, fingerprint, generation };
  }
  const sign = (prefix: string, target: TerminalTarget, identity: { fingerprint: string; generation: number }) =>
    createHmac('sha256', secret)
      .update(JSON.stringify([prefix, terminalTargetKey(target), identity.fingerprint, identity.generation]))
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
    async issue(
      target: TerminalTarget,
      options: { signal: AbortSignal; previousBinding?: string },
    ): Promise<TerminalBinding> {
      const identity = await readTarget(target, options.signal);
      if (options.previousBinding) check(options.previousBinding, target, identity, true);
      const expiresAt = Date.now() + TERMINAL_LIMITS.bindingMs;
      const prefix = `1.${expiresAt}.${randomBytes(16).toString('hex')}`;
      return { target, expiresAt, binding: `${prefix}.${sign(prefix, target, identity)}` };
    },
    async verify(target: TerminalTarget, binding: string, signal: AbortSignal) {
      const identity = await readTarget(target, signal);
      check(binding, target, identity, false);
      return identity;
    },
  };
}
export type TerminalBindings = ReturnType<typeof createTerminalBindings>;
