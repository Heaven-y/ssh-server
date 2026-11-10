import { useContext, useEffect } from 'react';
import { QueryClientContext, useMutation, useMutationState, useQuery, type QueryClient } from '@tanstack/react-query';
import type { AgentKind } from '@agentdeck/shared/conversation';
import type { CliInstallInput, CliInstallPhase } from '@agentdeck/shared/settings';
import { queryClient } from '../../lib/query-client';
import { ApiError } from '../../lib/http';
import { cliInstallationApi, cliInstallationKey } from './cli-installation-api';
import { observeCliInstallation } from './cli-installation-tracker';

type InstallationAction = { agent: AgentKind; action: 'check' } | ({ agent: AgentKind } & CliInstallInput);
const activePhases: CliInstallPhase[] = ['checking', 'installing', 'updating', 'verifying'];
export const installationActive = (phase?: CliInstallPhase) => !!phase && activePhases.includes(phase);
const errorMessages = new Map([
  ['agent_busy', '请结束该 CLI 会话后重试。'],
  ['revision_conflict', '本机安装状态已变化，请重新检查后再试。'],
  ['installation_busy', '已有安装或更新任务，请等待完成后再试。'],
  ['check_required', '请先重新检查最新版本，再安装或更新。'],
  ['unsupported', '当前安装来源不支持此操作，请使用官方安装指南。'],
  ['service_closed', '本机服务正在关闭，请稍后重试。'],
]);

export function cliInstallationError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '本机连接已失效，请刷新页面后重试。';
    const message = errorMessages.get(error.code ?? '');
    if (message) return message;
    if (error.status === 409) return '当前安装状态暂不可操作，请重新检查后再试。';
  }
  return '暂时无法读取或操作 CLI，请重试。';
}

async function installLatest(agent: AgentKind, client: QueryClient) {
  const checked = await cliInstallationApi.check(agent);
  await client.cancelQueries({ queryKey: cliInstallationKey(agent) });
  client.setQueryData(cliInstallationKey(agent), checked);
  if (checked.phase === 'failed' || installationActive(checked.phase) || !checked.canInstall || checked.installed)
    return checked;
  if (!checked.latestVersion || checked.checkedAt === null) throw new ApiError(409, '', { code: 'check_required' });
  return cliInstallationApi.operate(agent, { action: 'install', revision: checked.revision });
}

export function useCliInstallation(agent: AgentKind) {
  const client = useContext(QueryClientContext) ?? queryClient;
  const key = cliInstallationKey(agent);
  const mutationKey = ['cli-installation-action', agent];
  const pendingAction = useMutationState<InstallationAction | undefined>(
    {
      filters: { mutationKey, status: 'pending' },
      select: (entry) => entry.state.variables as InstallationAction,
    },
    client,
  ).at(-1)?.action;
  const status = useQuery(
    {
      queryKey: key,
      queryFn: ({ signal }) => cliInstallationApi.read(agent, signal),
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: (query) =>
        query.state.status !== 'error' && query.state.data?.phase === 'checking' ? 1000 : false,
    },
    client,
  );
  useEffect(() => {
    if (status.isSuccess && status.data) void observeCliInstallation(client, status.data);
  }, [client, status.data, status.dataUpdatedAt, status.isSuccess]);
  const mutation = useMutation(
    {
      mutationKey,
      mutationFn: async (input: InstallationAction) => {
        await client.cancelQueries({ queryKey: cliInstallationKey(input.agent) });
        if (input.action === 'check') return cliInstallationApi.check(input.agent);
        if (input.action === 'install') return installLatest(input.agent, client);
        return cliInstallationApi.operate(input.agent, { action: input.action, revision: input.revision });
      },
      onSuccess: async (result, input) => {
        // POST不随面板卸载取消，迟到响应只更新请求所属的CLI。
        await client.cancelQueries({ queryKey: cliInstallationKey(input.agent) });
        client.setQueryData(cliInstallationKey(input.agent), result);
        await observeCliInstallation(client, result);
      },
      retry: false,
    },
    client,
  );
  const act = (action: InstallationAction['action']) => {
    if (client.isMutating({ mutationKey }) || installationActive(status.data?.phase) || !status.data) return;
    mutation.mutate(action === 'check' ? { agent, action } : { agent, action, revision: status.data.revision });
  };
  return {
    status,
    pendingAction,
    busy: installationActive(status.data?.phase) || !!pendingAction,
    error: (mutation.variables?.agent === agent ? mutation.error : null) ?? status.error,
    act,
    retry() {
      mutation.reset();
      void status.refetch();
    },
  };
}
