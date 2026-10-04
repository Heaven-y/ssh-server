import { useId, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ManualServerInputSchema, type ManualServerInput, type WorkspaceInput } from '@ssh-server/shared';
import { api, queryKeys } from '../../../lib/api';
import { buttonClass, inputClass } from '../../../ui/styles';
import { HostKeyConfirmation } from '../../ssh/HostKeyConfirmation';
import { SshPasswordField } from '../../ssh/SshPasswordField';
import { SshConnectionFeedback } from '../../ssh/SshConnectionPanel';
import type { useSshConnection } from '../../ssh/use-ssh-connection';
import { useCancelableRequest } from './use-cancelable-request';

type Connection = ReturnType<typeof useSshConnection>;
const SERVER_FIELDS = [
  { key: 'name', label: '连接名称', placeholder: '我的服务器' },
  { key: 'hostname', label: '地址', placeholder: 'my-server' },
  { key: 'username', label: '账号', placeholder: 'user' },
  { key: 'keyFile', label: '私钥文件路径（可选）', placeholder: '留空使用本机默认私钥' },
] as const;
function ManualServerForm({ saved }: { saved(alias: string): void }) {
  const id = useId();
  const qc = useQueryClient();
  const [input, setInput] = useState<ManualServerInput>({ name: '', hostname: '', username: '', port: 22 });
  const request = useCancelableRequest();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const server = await request.run(async (signal) => {
      const parsed = ManualServerInputSchema.safeParse({ ...input, keyFile: input.keyFile || undefined });
      if (!parsed.success) throw new Error('请检查连接名称、地址、账号、端口和私钥路径');
      const result = await api.saveSshTarget(parsed.data, signal);
      void qc.invalidateQueries({ queryKey: queryKeys.sshHosts });
      return result;
    });
    if (server) saved(server.alias);
  };
  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer py-1 text-sm font-medium">手动添加服务器</summary>
      <form aria-label="保存本机连接" onSubmit={(event) => void save(event)} className="mt-4 grid gap-3 sm:grid-cols-2">
        {SERVER_FIELDS.map((field) => (
          <div key={field.key}>
            <label htmlFor={`${id}-${field.key}`} className="mb-2 block text-xs">
              {field.label}
            </label>
            <input
              id={`${id}-${field.key}`}
              className={inputClass}
              value={input[field.key] ?? ''}
              placeholder={field.placeholder}
              disabled={request.busy}
              autoComplete="off"
              onChange={(event) => setInput((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          </div>
        ))}
        <div>
          <label htmlFor={`${id}-port`} className="mb-2 block text-xs">
            端口
          </label>
          <input
            id={`${id}-port`}
            type="number"
            min={1}
            max={65535}
            className={inputClass}
            value={Number.isNaN(input.port) ? '' : input.port}
            disabled={request.busy}
            onChange={(event) => setInput((current) => ({ ...current, port: Number(event.target.value) }))}
          />
        </div>
        <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
          明确保存后可重复使用；取消工作区向导会保留此连接。密码通过下方认证单独输入。
        </p>
        {request.error && (
          <p role="alert" className="text-xs text-destructive-foreground sm:col-span-2">
            {request.error}
          </p>
        )}
        <button type="submit" className={`${buttonClass('outline')} w-fit`} disabled={request.busy}>
          {request.busy ? '正在保存…' : '保存本机连接'}
        </button>
      </form>
    </details>
  );
}
function ServerPicker({
  input,
  change,
  busy,
}: {
  input: WorkspaceInput;
  change(patch: Partial<WorkspaceInput>): void;
  busy: boolean;
}) {
  const id = useId();
  const hosts = useQuery({ queryKey: queryKeys.sshHosts, queryFn: api.listSshHosts });
  const selected = hosts.data?.find((host) => host.alias === input.sshHost);
  return (
    <>
      <div>
        <label htmlFor={id} className="mb-2 block text-sm font-medium">
          服务器
        </label>
        <select
          id={id}
          className={inputClass}
          value={input.sshHost}
          disabled={busy || hosts.isPending}
          onChange={(event) => change({ sshHost: event.target.value })}
        >
          <option value="">{hosts.isPending ? '正在读取…' : '请选择服务器'}</option>
          {hosts.data?.map((host) => (
            <option key={host.alias} value={host.alias} disabled={Boolean(host.unsupported.length)}>
              {host.name ?? host.alias} · {host.source === 'manual' ? '本机连接' : 'SSH配置'}
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <p className="font-mono text-xs text-muted-foreground wrap-anywhere">
          {selected.user}@{selected.hostname}:{selected.port}
        </p>
      )}
      {hosts.isError && (
        <p role="alert" className="text-xs text-destructive-foreground">
          服务器列表读取失败
        </p>
      )}
      <button
        type="button"
        className={`${buttonClass('ghost')} self-start`}
        disabled={hosts.isFetching}
        onClick={() => void hosts.refetch()}
      >
        重新读取服务器
      </button>
    </>
  );
}
export function ServerStep({
  input,
  change,
  connection,
}: {
  input: WorkspaceInput;
  change(patch: Partial<WorkspaceInput>): void;
  connection: Connection;
}) {
  const id = useId();
  const needsPassword = input.authMode === 'password' && !connection.hasPassword && !connection.saved;
  return (
    <div className="flex flex-col gap-4">
      <ServerPicker input={input} change={change} busy={connection.busy} />
      <ManualServerForm saved={(sshHost) => change({ sshHost })} />
      <fieldset disabled={connection.busy} className="flex flex-wrap gap-3">
        <legend className="mb-2 text-sm font-medium">认证方式</legend>
        {(
          [
            { mode: 'key', label: '已有私钥' },
            { mode: 'password', label: '账号密码' },
          ] as const
        ).map(({ mode, label }) => (
          <label key={mode} className="flex min-h-11 items-center gap-2 rounded border border-border px-3">
            <input
              type="radio"
              name={`${id}-auth`}
              checked={(input.authMode ?? 'key') === mode}
              onChange={() => change({ authMode: mode })}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <HostKeyConfirmation
        sshHost={input.sshHost}
        disabled={connection.busy}
        onChecking={connection.reset}
        onTrusted={connection.reset}
      />
      {input.authMode === 'password' && <SshPasswordField connection={connection} disabled={connection.busy} />}
      <button
        type="button"
        className={`${buttonClass('outline')} self-start`}
        disabled={connection.busy || !input.sshHost || needsPassword}
        onClick={() => void connection.connect()}
      >
        {connection.busy ? '正在测试…' : '测试认证与连接'}
      </button>
      <SshConnectionFeedback connection={connection} />
    </div>
  );
}
