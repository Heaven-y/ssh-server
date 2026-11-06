import { useEffect, useRef, useState } from 'react';
import type { SshConsoleTerminal } from '@agentdeck/shared/ssh';
import { sshConsoleApi } from './api';
import { consoleError } from './console-state';

/** 同一服务器的自动首终端创建合并；卸载不会取消已送出的创建或关闭后端 PTY。 */
const initialTerminalRequests = new Map<string, Promise<SshConsoleTerminal[]>>();
function initialTerminals(serverId: string, directory: string) {
  const existing = initialTerminalRequests.get(serverId);
  if (existing) return existing;
  const pending = sshConsoleApi
    .terminals(serverId)
    .then(async ({ terminals }) =>
      terminals.length
        ? terminals
        : [await sshConsoleApi.createTerminal(serverId, { cols: 100, rows: 30, remoteDir: directory })],
    );
  initialTerminalRequests.set(serverId, pending);
  void pending
    .finally(() => {
      if (initialTerminalRequests.get(serverId) === pending) initialTerminalRequests.delete(serverId);
    })
    .catch(() => undefined);
  return pending;
}

export function useConsoleTerminals(serverId: string, directory: string, visible: boolean) {
  const [terminals, setTerminals] = useState<SshConsoleTerminal[]>([]);
  const [selected, setSelected] = useState<string>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!visible || ready) return;
    let cancelled = false;
    void initialTerminals(serverId, directory)
      .then((items) => {
        if (!cancelled) {
          setTerminals(items);
          setSelected(items[0]?.id);
          setReady(true);
          setError('');
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(consoleError(reason));
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, directory, visible, ready]);
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (reason) {
      if (mounted.current) setError(consoleError(reason));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const create = () =>
    run(async () => {
      const terminal = await sshConsoleApi.createTerminal(serverId, { cols: 100, rows: 30, remoteDir: directory });
      if (mounted.current) {
        setTerminals((items) => [...items, terminal]);
        setSelected(terminal.id);
      }
    });
  const close = (id: string) =>
    run(async () => {
      await sshConsoleApi.closeTerminal(serverId, id);
      if (mounted.current) {
        setTerminals((items) => items.filter((item) => item.id !== id));
        setSelected((current) => (current === id ? terminals.find((item) => item.id !== id)?.id : current));
      }
    });
  return { terminals, selected, ready, error, busy, select: setSelected, create, close, retry: () => setReady(false) };
}
