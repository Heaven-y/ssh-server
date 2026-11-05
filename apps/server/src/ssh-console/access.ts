import { SshConsoleServerIdSchema } from '@agentdeck/shared';
import type { SshConsoleDeps } from './types';
import { SshConsoleError } from './errors';

/** 一个租约固定一次连接代次；停用、断开与凭据更新同时取消它拥有的通道。 */
export function createConsoleAccess(deps: SshConsoleDeps) {
  const active = new Set<AbortController>();
  let epoch = 0;
  const assertEnabled = () => {
    if (!deps.isEnabled()) throw new SshConsoleError('plugin_disabled');
  };
  async function capture(serverId: string, signal?: AbortSignal) {
    assertEnabled();
    if (!SshConsoleServerIdSchema.safeParse(serverId).success) throw new SshConsoleError('invalid_request');
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const originalEpoch = epoch;
    const generation = deps.pool.generation(serverId);
    const target = { alias: serverId };
    const detach = deps.pool.onCredentialsChanged(serverId, () =>
      controller.abort(new SshConsoleError('target_changed')),
    );
    active.add(controller);
    const close = () => {
      active.delete(controller);
      detach();
      controller.abort(new SshConsoleError('cancelled'));
    };
    const check = () => {
      assertEnabled();
      if (originalEpoch !== epoch || deps.pool.generation(serverId) !== generation)
        throw new SshConsoleError('target_changed');
      combined.throwIfAborted();
    };
    try {
      check();
      const connection = await deps.pool.resolveConnection(target);
      check();
      return {
        target,
        signal: combined,
        guard: { generation, cacheKey: connection.cacheKey, signal: combined },
        check,
        close,
        async recheck() {
          check();
          const current = await deps.pool.resolveConnection(target);
          check();
          if (current.cacheKey !== connection.cacheKey) throw new SshConsoleError('target_changed');
        },
      };
    } catch (error) {
      close();
      throw error;
    }
  }
  return {
    assertEnabled,
    capture,
    dispose() {
      epoch++;
      for (const controller of active) controller.abort(new SshConsoleError('cancelled'));
      active.clear();
    },
  };
}
export type ConsoleAccess = ReturnType<typeof createConsoleAccess>;
export type ConsoleLease = Awaited<ReturnType<ConsoleAccess['capture']>>;
