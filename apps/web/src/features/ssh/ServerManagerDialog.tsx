import { useId, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ManagedServer, ManualServerInput, Workspace } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass, inputClass } from '../../ui/styles';
import { useCancelableRequest } from '../workspaces/setup/use-cancelable-request';
import { EMPTY_SERVER, ManualServerForm } from './ManualServerForm';
import { ServerConnectionForm } from './ServerConnectionForm';
import { SshImportOptions } from './SshImportOptions';

type Editor = { initial: ManualServerInput; expected?: ManagedServer };
function DeleteServer({ server, done, cancel }: { server: ManagedServer; done(): void; cancel(): void }) {
  const [confirmed, setConfirmed] = useState(false);
  const request = useCancelableRequest();
  const qc = useQueryClient();
  const remove = async () => {
    if (!confirmed || request.busy) return;
    const removed = await request.run(async (signal) => {
      try {
        await api.deleteSshTarget(server, signal);
        await qc.cancelQueries({ queryKey: queryKeys.sshHosts });
        return true;
      } finally {
        void qc.invalidateQueries({ queryKey: queryKeys.sshHosts, refetchType: 'none' });
      }
    });
    if (removed) {
      qc.setQueryData<ManagedServer[]>(queryKeys.sshHosts, (current = []) =>
        current.filter((item) => item.alias !== server.alias),
      );
      qc.removeQueries({ queryKey: queryKeys.sshCredentials(server.alias) });
      done();
    }
  };
  return (
    <section aria-label="确认删除服务器" className="space-y-3 rounded border border-destructive p-4">
      <p className="text-sm">
        删除“{server.name}”会清理该服务器的连接和保存凭据，不删除远端文件。存在工作区引用或活动任务时服务端将拒绝。
      </p>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={request.busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        我确认删除此服务器档案
      </label>
      {request.error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {request.error}；请取消后重新读取档案。
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass('danger')}
          disabled={!confirmed || request.busy}
          onClick={() => void remove()}
        >
          确认删除服务器
        </button>
        <button type="button" className={buttonClass('outline')} onClick={cancel}>
          取消删除
        </button>
      </div>
    </section>
  );
}

type Screen =
  | { kind: 'view'; connectAfterSave?: boolean }
  | { kind: 'import' }
  | { kind: 'edit'; editor: Editor }
  | { kind: 'delete'; server: ManagedServer };
function ServerList({
  hosts,
  alias,
  select,
}: {
  hosts: UseQueryResult<ManagedServer[]>;
  alias: string;
  select(alias: string): void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm">
        已保存服务器
      </label>
      <select id={id} className={inputClass} value={alias} onChange={(event) => select(event.target.value)}>
        <option value="">{hosts.isPending ? '正在读取…' : '请选择服务器'}</option>
        {hosts.data?.map((server) => (
          <option key={server.alias} value={server.alias}>
            {server.name} · {server.username}@{server.hostname}:{server.port}
          </option>
        ))}
      </select>
      {hosts.error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          服务器列表读取失败：{hosts.error.message}
        </p>
      )}
      {hosts.data?.length === 0 && <p className="text-sm text-muted-foreground">尚未保存服务器，请新增或导入。</p>}
    </div>
  );
}
function ReferenceNotice({ workspaces, alias }: { workspaces: UseQueryResult<Workspace[]>; alias: string }) {
  if (workspaces.isError)
    return (
      <p role="alert" className="text-sm text-warning">
        工作区引用读取失败，暂不允许修改连接目标或删除。请重新读取。
      </p>
    );
  if (!alias) return null;
  const referenced = workspaces.data?.filter((workspace) => workspace.sshHost === alias) ?? [];
  return (
    <div className="rounded border border-border p-3 text-sm leading-6">
      {referenced.length ? (
        <p>
          受影响工作区：{referenced.map((workspace) => workspace.name).join('、')}。认证和连接状态由这些工作区共享。
        </p>
      ) : (
        <p>{workspaces.isPending ? '正在读取工作区引用…' : '当前没有工作区引用此服务器。'}</p>
      )}
    </div>
  );
}
function ProfileDetails({
  server,
  locked,
  changeScreen,
  chooseServer,
  connectAfterSave = false,
}: {
  server: ManagedServer;
  locked: boolean;
  changeScreen(screen: Screen): void;
  chooseServer?: (alias: string) => void;
  connectAfterSave?: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm">{server.authMode === 'key' ? '已有私钥' : '账号密码'}</p>
        <button
          type="button"
          className={buttonClass('outline')}
          onClick={() => changeScreen({ kind: 'edit', editor: { initial: server, expected: server } })}
        >
          编辑服务器
        </button>
        <button
          type="button"
          className={buttonClass('danger')}
          disabled={locked}
          onClick={() => changeScreen({ kind: 'delete', server })}
        >
          删除服务器
        </button>
      </div>
      <ServerConnectionForm key={JSON.stringify(server)} server={server} connectAfterSave={connectAfterSave} />
      {chooseServer && (
        <button type="button" className={`${buttonClass('primary')} w-full`} onClick={() => chooseServer(server.alias)}>
          使用此服务器
        </button>
      )}
    </>
  );
}
function ServerContent({
  screen,
  selected,
  locked,
  changeScreen,
  saved,
  reset,
  chooseServer,
}: {
  screen: Screen;
  selected?: ManagedServer;
  locked: boolean;
  changeScreen(screen: Screen): void;
  saved(server: ManagedServer): void;
  reset(): void;
  chooseServer?: (alias: string) => void;
}) {
  if (screen.kind === 'import')
    return <SshImportOptions select={(initial) => changeScreen({ kind: 'edit', editor: { initial } })} />;
  if (screen.kind === 'edit')
    return (
      <ManualServerForm
        key={JSON.stringify(screen.editor)}
        {...screen.editor}
        identityLocked={!!screen.editor.expected && locked}
        saved={saved}
        cancel={reset}
      />
    );
  if (screen.kind === 'delete')
    return <DeleteServer key={screen.server.alias} server={screen.server} done={reset} cancel={reset} />;
  return selected ? (
    <ProfileDetails
      server={selected}
      locked={locked}
      changeScreen={changeScreen}
      chooseServer={chooseServer}
      connectAfterSave={screen.connectAfterSave}
    />
  ) : null;
}

/** 顶栏、工作区详情和向导共用此入口；切换档案会卸载密码和在途请求。 */
export function ServerManagerDialog({
  initialAlias = '',
  onClose,
  onSelect,
}: {
  initialAlias?: string;
  onClose(): void;
  onSelect?(alias: string): void;
}) {
  const hosts = useQuery({
    queryKey: queryKeys.sshHosts,
    queryFn: ({ signal }) => api.listSshHosts(signal),
    retry: false,
  });
  const workspaces = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: ({ signal }) => api.listWorkspaces(signal),
    retry: false,
  });
  const [alias, setAlias] = useState(initialAlias);
  const [screen, setScreen] = useState<Screen>({ kind: 'view' });
  const selected = hosts.data?.find((server) => server.alias === alias);
  const locked = !workspaces.isSuccess || workspaces.data.some((workspace) => workspace.sshHost === alias);
  const reset = () => setScreen({ kind: 'view' });
  const select = (value: string) => {
    reset();
    setAlias(value);
  };
  const chooseServer = onSelect
    ? (value: string) => {
        onSelect(value);
        onClose();
      }
    : undefined;
  return (
    <DetailDialog title="服务器" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass('primary')}
            onClick={() => setScreen({ kind: 'edit', editor: { initial: EMPTY_SERVER } })}
          >
            新增服务器
          </button>
          <button type="button" className={buttonClass('outline')} onClick={() => setScreen({ kind: 'import' })}>
            从 SSH 配置导入
          </button>
          <button
            type="button"
            className={buttonClass('ghost')}
            disabled={hosts.isFetching}
            onClick={() => {
              reset();
              void hosts.refetch();
              void workspaces.refetch();
            }}
          >
            重新读取
          </button>
        </div>
        <ServerList hosts={hosts} alias={alias} select={select} />
        <ReferenceNotice workspaces={workspaces} alias={alias} />
        <ServerContent
          screen={screen}
          selected={selected}
          locked={locked}
          changeScreen={setScreen}
          saved={(server) => {
            setAlias(server.alias);
            setScreen({
              kind: 'view',
              connectAfterSave: server.authMode === 'password' && screen.kind === 'edit' && !screen.editor.expected,
            });
          }}
          reset={reset}
          chooseServer={chooseServer}
        />
      </div>
    </DetailDialog>
  );
}
