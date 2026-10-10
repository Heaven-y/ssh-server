import { useCallback, useEffect, useRef, useState } from 'react';
import type { ManagedServer, SshAuthMode } from '@ssh-server/shared';
import { api, ApiError } from '../../lib/api';

type Metadata = { phase: 'loading' | 'ready' | 'reread'; revision?: string; savingAvailable: boolean; error?: string };

/** 明文只驻留当前输入框；状态、缓存和编辑快照均不携带密码。 */
export function useServerPasswordEditor(expected?: ManagedServer) {
  const element = useRef<HTMLInputElement | null>(null);
  const modified = useRef(false);
  const targetChanged = useRef(false);
  const [identityChanged, setIdentityChanged] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reload, setReload] = useState(0);
  const [metadata, setMetadata] = useState<Metadata>({ phase: expected ? 'loading' : 'ready', savingAvailable: true });
  const passwordRef = useCallback((node: HTMLInputElement | null) => {
    element.current = node;
    if (!node) return;
    return () => {
      node.value = '';
      if (element.current === node) element.current = null;
    };
  }, []);

  useEffect(() => {
    if (!expected) return;
    const controller = new AbortController();
    void api
      .readSshPassword(expected, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        // 输入目标在读取期间改变过，即使随后改回，也必须由用户重新输入。
        if (element.current && !modified.current && !targetChanged.current)
          element.current.value = result.password ?? '';
        setMetadata({ phase: 'ready', revision: result.revision, savingAvailable: result.savingAvailable });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setMetadata({
            phase: 'reread',
            savingAvailable: false,
            error: error instanceof ApiError ? error.message : '无法读取本机保存密码，请重新读取或取消编辑。',
          });
      });
    return () => controller.abort();
  }, [expected, reload]);

  const clear = () => {
    if (element.current) {
      element.current.value = '';
      element.current.type = 'password';
    }
    setVisible(false);
  };
  const changeTarget = () => {
    clear();
    modified.current = true;
    targetChanged.current = true;
    setIdentityChanged(true);
  };
  const take = (authMode: SshAuthMode) => {
    const value = element.current?.value ?? '';
    const password = authMode === 'password' && (modified.current || !expected) ? value || null : undefined;
    const revision = metadata.revision;
    clear();
    modified.current = false;
    if (expected) setMetadata({ ...metadata, phase: 'reread', revision: undefined });
    return { revision, password };
  };
  const reread = () => {
    clear();
    modified.current = targetChanged.current;
    setMetadata({ phase: 'loading', savingAvailable: true });
    setReload((value) => value + 1);
  };
  return {
    ...metadata,
    visible,
    passwordRef,
    identityChanged,
    ready: metadata.phase === 'ready',
    changeTarget,
    take,
    reread,
    change: () => {
      modified.current = true;
    },
    toggle: () => setVisible((value) => !value),
  };
}
