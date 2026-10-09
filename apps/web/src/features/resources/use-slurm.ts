import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { terminalTargetKey, type SlurmSnapshot, type TerminalTarget } from '@ssh-server/shared';
import { api, ApiError } from '../../lib/api';
import { useServerObservationVersion } from './use-server-observation';

type Reading = { identity: string; data?: SlurmSnapshot; error?: string; loading: boolean };
const CHANGED = '服务器配置或认证已变化，请手动刷新作业。';

/** 页面内只留当前快照；首次激活或手动读取，无焦点刷新、轮询或跨目标缓存。 */
export function useSlurm(target: TerminalTarget, active: boolean) {
  const { workspaceId, sshHost, remoteDir } = target;
  const fixed = useMemo(() => ({ workspaceId, sshHost, remoteDir }), [workspaceId, sshHost, remoteDir]);
  const version = useServerObservationVersion(sshHost);
  const identity = JSON.stringify([terminalTargetKey(fixed), version]);
  const [reading, setReading] = useState<Reading>();
  const attempted = useRef<string | undefined>(undefined);
  const request = useRef<AbortController | undefined>(undefined);
  const read = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setReading((previous) => ({
      identity,
      data: previous?.identity === identity ? previous.data : undefined,
      loading: true,
    }));
    try {
      const data = await api.readSlurm(fixed, controller.signal);
      if (controller.signal.aborted) return;
      attempted.current = identity;
      setReading({ identity, data, loading: false });
    } catch (error) {
      if (controller.signal.aborted) return;
      attempted.current = identity;
      setReading({
        identity,
        loading: false,
        error: error instanceof ApiError ? error.message : '作业查询失败，请检查本机连接后重试。',
      });
    }
  }, [identity, fixed]);
  useEffect(() => {
    if (active && version === 0 && attempted.current !== identity) void read();
    return () => {
      request.current?.abort();
      setReading((current) =>
        current?.identity === identity && current.loading ? { ...current, loading: false } : current,
      );
    };
  }, [active, identity, version, read]);
  const current = reading?.identity === identity ? reading : undefined;
  return {
    data: current?.data,
    error: current?.error ?? (!current && version > 0 ? CHANGED : undefined),
    loading: active && !!current?.loading,
    refresh: () => {
      if (active) void read();
    },
  };
}
