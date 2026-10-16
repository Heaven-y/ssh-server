import { useId } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { ManagedServer, Workspace } from '@ssh-server/shared';
import { api, queryKeys, type SshCredentialStatus } from '../../lib/api';

function connectionLabel(status: SshCredentialStatus) {
  if (status.connected) return '已连接';
  return status.paused ? '已断开 · 自动连接已暂停' : '未连接';
}
function passwordLabel(status: SshCredentialStatus) {
  if (status.saved) return '已保存密码';
  return status.hasPassword ? '临时密码可复用' : '需输入密码';
}
function ServerStatus({ server }: { server: ManagedServer }) {
  // 只读状态与所选详情共用缓存；列表不增加轮询，更不会触发认证或自动连接。
  const status = useQuery({
    queryKey: queryKeys.sshCredentials(server.alias),
    queryFn: ({ signal }) => api.sshCredentials(server.alias, signal),
    retry: false,
    staleTime: 10000,
  });
  if (status.isError) return <span className="text-warning">状态读取失败</span>;
  if (!status.data) return <span>状态读取中…</span>;
  return (
    <>
      <span className={status.data.connected ? 'text-success' : undefined}>{connectionLabel(status.data)}</span>
      {server.authMode === 'password' && <span>{passwordLabel(status.data)}</span>}
    </>
  );
}
function referenceLabel(workspaces: UseQueryResult<Workspace[]>, alias: string) {
  if (workspaces.isError) return '引用读取失败';
  if (!workspaces.data) return '引用读取中…';
  const count = workspaces.data.filter((workspace) => workspace.sshHost === alias).length;
  return count ? `${count} 个工作区引用` : '无工作区引用';
}
function ServerRow({
  server,
  selected,
  references,
  mode,
  select,
}: {
  server: ManagedServer;
  selected: boolean;
  references: string;
  mode: 'edit' | 'select';
  select(alias: string): void;
}) {
  const id = useId();
  const target = `${server.username}@${server.hostname}:${server.port}`;
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-label={`${mode === 'edit' ? '编辑服务器' : '选择服务器'}：${server.name}`}
        aria-pressed={selected}
        aria-describedby={`${id}-target ${id}-status ${id}-references`}
        onClick={() => select(server.alias)}
        className={`flex min-h-11 w-full min-w-0 items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${selected ? 'border-accent/60 bg-accent/10' : 'border-border hover:bg-muted/50'}`}
      >
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block truncate text-sm font-medium" title={server.name}>
            {server.name}
          </span>
          <span id={`${id}-target`} className="block truncate font-mono text-xs text-muted-foreground" title={target}>
            {target}
          </span>
          <span id={`${id}-status`} className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{server.authMode === 'key' ? '已有私钥' : '账号密码'}</span>
            <ServerStatus server={server} />
          </span>
          <span id={`${id}-references`} className="block text-xs text-muted-foreground">
            {references}
          </span>
        </span>
        {selected && <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />}
      </button>
    </li>
  );
}

export function ServerList({
  hosts,
  workspaces,
  alias,
  mode,
  select,
}: {
  hosts: UseQueryResult<ManagedServer[]>;
  workspaces: UseQueryResult<Workspace[]>;
  alias: string;
  mode: 'edit' | 'select';
  select(alias: string): void;
}) {
  return (
    <section aria-label="已保存服务器" className="min-w-0 space-y-3">
      <h3 className="text-sm font-medium">已保存服务器</h3>
      {hosts.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取服务器…
        </p>
      )}
      {hosts.error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          服务器列表读取失败：{hosts.error.message}
        </p>
      )}
      {hosts.isSuccess && hosts.data.length === 0 && (
        <p className="text-sm text-muted-foreground">暂无服务器，可新增或导入</p>
      )}
      {!!hosts.data?.length && (
        <ul aria-label="服务器列表" className="max-h-72 space-y-2 overflow-y-auto p-1">
          {hosts.data.map((server) => (
            <ServerRow
              key={JSON.stringify(server)}
              server={server}
              selected={server.alias === alias}
              references={referenceLabel(workspaces, server.alias)}
              mode={mode}
              select={select}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
