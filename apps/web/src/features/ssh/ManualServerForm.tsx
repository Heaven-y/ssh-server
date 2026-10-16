import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ManualServerInputSchema, type ManualServerInput, type ManagedServer } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { buttonClass, inputClass } from '../../ui/styles';
import { useCancelableRequest } from '../workspaces/setup/use-cancelable-request';
import { ServerPasswordEditor } from './ServerPasswordEditor';
import { useServerPasswordEditor } from './use-server-password-editor';

const FIELDS = [
  { key: 'name', label: '连接名称', placeholder: '我的服务器' },
  { key: 'hostname', label: '地址', placeholder: 'my-server' },
  { key: 'username', label: '账号', placeholder: 'user' },
  { key: 'keyFile', label: '私钥文件路径（可选）', placeholder: '留空使用本机默认私钥' },
] as const;
export const EMPTY_SERVER: ManualServerInput = { name: '', hostname: '', username: '', port: 22, authMode: 'key' };

function saveProfile(
  input: ManualServerInput,
  expected: ManagedServer | undefined,
  credential: { revision?: string; password?: string | null },
  signal: AbortSignal,
) {
  if (expected) {
    if (!credential.revision) throw new Error('请先重新读取服务器编辑信息');
    return api.saveSshTargetEdit(
      { input, expected, revision: credential.revision, password: credential.password },
      signal,
    );
  }
  return typeof credential.password === 'string'
    ? api.createSshTargetWithPassword(input, credential.password, signal)
    : api.saveSshTarget(input, signal);
}

/** 唯一档案编辑表单；密码单独按需读取、确认保存，不混入服务器快照。 */
export function ManualServerForm({
  initial = EMPTY_SERVER,
  expected,
  identityLocked = false,
  saved,
  cancel,
}: {
  initial?: ManualServerInput;
  expected?: ManagedServer;
  identityLocked?: boolean;
  saved(server: ManagedServer): void;
  cancel(): void;
}) {
  const id = useId();
  const qc = useQueryClient();
  const [input, setInput] = useState<ManualServerInput>(() => ({
    name: initial.name,
    hostname: initial.hostname,
    username: initial.username,
    port: initial.port,
    authMode: initial.authMode,
    keyFile: initial.keyFile,
  }));
  const request = useCancelableRequest();
  const credential = useServerPasswordEditor(expected);
  const change = (patch: Partial<ManualServerInput>) => {
    if (Object.keys(patch).some((key) => key !== 'name')) credential.changeTarget();
    setInput((value) => ({ ...value, ...patch }));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (request.busy || !credential.ready) return;
    const server = await request.run(async (signal) => {
      const parsed = ManualServerInputSchema.safeParse({
        ...input,
        keyFile: input.authMode === 'key' ? input.keyFile || undefined : undefined,
      });
      if (!parsed.success) throw new Error('请检查连接名称、地址、账号、端口和私钥路径');
      const secret = credential.take(parsed.data.authMode);
      if (expected) {
        void qc.invalidateQueries({ queryKey: queryKeys.sshCredentials(expected.alias), refetchType: 'none' });
        void qc.cancelQueries({ queryKey: queryKeys.sshCredentials(expected.alias) });
      }
      try {
        const updated = await saveProfile(parsed.data, expected, secret, signal);
        // 保存已使服务端断开旧身份；重读期间不能继续展示旧的已连接缓存。
        void qc.resetQueries({ queryKey: queryKeys.sshCredentials(updated.alias) });
        await qc.cancelQueries({ queryKey: queryKeys.sshHosts });
        return updated;
      } catch (error) {
        if (expected) void qc.invalidateQueries({ queryKey: queryKeys.sshCredentials(expected.alias) });
        throw error;
      } finally {
        void qc.invalidateQueries({ queryKey: queryKeys.sshHosts, refetchType: 'none' });
      }
    });
    if (server) {
      qc.setQueryData<ManagedServer[]>(queryKeys.sshHosts, (current = []) => [
        ...current.filter((item) => item.alias !== server.alias),
        server,
      ]);
      saved(server);
    }
  };
  return (
    <form aria-label="服务器档案" onSubmit={(event) => void save(event)} className="grid gap-3 sm:grid-cols-2">
      {FIELDS.filter((field) => field.key !== 'keyFile' || input.authMode === 'key').map((field) => (
        <div key={field.key}>
          <label htmlFor={`${id}-${field.key}`} className="mb-2 block text-sm">
            {field.label}
          </label>
          <input
            id={`${id}-${field.key}`}
            className={inputClass}
            value={input[field.key] ?? ''}
            placeholder={field.placeholder}
            disabled={request.busy || (identityLocked && field.key !== 'name')}
            autoComplete="off"
            onChange={(event) => change({ [field.key]: event.target.value })}
          />
        </div>
      ))}
      <div>
        <label htmlFor={`${id}-port`} className="mb-2 block text-sm">
          端口
        </label>
        <input
          id={`${id}-port`}
          type="number"
          min={1}
          max={65535}
          className={inputClass}
          value={input.port}
          disabled={request.busy || identityLocked}
          onChange={(event) => change({ port: Number(event.target.value) })}
        />
      </div>
      <div>
        <label htmlFor={`${id}-auth`} className="mb-2 block text-sm">
          认证方式
        </label>
        <select
          id={`${id}-auth`}
          className={inputClass}
          value={input.authMode}
          disabled={request.busy || (identityLocked && !!initial.keyFile)}
          onChange={(event) => change({ authMode: event.target.value as ManualServerInput['authMode'] })}
        >
          <option value="key">已有私钥</option>
          <option value="password">账号密码</option>
        </select>
      </div>
      <ServerPasswordEditor editor={credential} passwordMode={input.authMode === 'password'} busy={request.busy} />
      <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
        {identityLocked
          ? '已有工作区引用，地址、端口、账号与私钥不可更改；认证方式只能在空闲时变更，变更后需重新验证。'
          : '保存后可被多个工作区共用；密码由本机加密保存。'}
      </p>
      {request.error && (
        <p role="alert" className="text-sm text-destructive-foreground sm:col-span-2">
          {request.error}；若档案已变化，请取消后重新读取。
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={buttonClass('primary')} disabled={request.busy || !credential.ready}>
          {request.busy ? '正在保存…' : '保存服务器'}
        </button>
        <button type="button" className={buttonClass('outline')} onClick={cancel}>
          取消编辑
        </button>
      </div>
    </form>
  );
}
