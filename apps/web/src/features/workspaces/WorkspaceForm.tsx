import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { PlugZap, RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  WorkspaceInputSchema,
  type SshAuthMode,
  type SshHostInfo,
  type Workspace,
  type WorkspaceInput,
} from '@ssh-server/shared';
import { api, ApiError, queryKeys } from '../../lib/api';
import { buttonClass, inputClass } from '../../ui/styles';
import { SshConnectionFeedback } from '../ssh/SshConnectionPanel';
import { SshPasswordField } from '../ssh/SshPasswordField';
import { sshTargetErrors, useSshConnection } from '../ssh/use-ssh-connection';

type Field = 'name' | 'localDir' | 'sshHost' | 'remoteDir';
type Values = Record<Field, string> & { authMode: SshAuthMode };
type Errors = Partial<Record<Field | 'authMode' | 'form', string>>;

const EMPTY: Values = { name: '', localDir: '', sshHost: '', remoteDir: '~', authMode: 'key' };
const AUTH_MODES = [
  { mode: 'key', label: '已有私钥' },
  { mode: 'password', label: '账号密码' },
] as const;

/** 前端校验字段格式，路径是否存在、Host 配置和 SSH 认证由后端核对。 */
function validate(values: Values): Errors {
  const result = WorkspaceInputSchema.safeParse(values);
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as Field;
    errors[field] ??=
      field === 'name' ? '请填写名称（不超过 100 字）' : issue.message.startsWith('Too small') ? '必填' : issue.message;
  }
  return errors;
}

function focusError(id: string, errors: Errors) {
  const field = Object.keys(errors).find((key) => key in EMPTY);
  if (field) document.getElementById(`${id}-${field}`)?.focus();
}

function FormField(props: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: (a: { describedBy?: string }) => ReactNode;
}) {
  const errId = `${props.id}-err`;
  const hintId = `${props.id}-hint`;
  const describedBy = [props.error && errId, props.hint && hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={props.id} className="text-sm font-medium">
        {props.label}
      </label>
      {props.children({ describedBy })}
      {props.hint && (
        <p id={hintId} className="text-xs leading-5 text-muted-foreground wrap-anywhere">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={errId} className="text-xs leading-5 text-destructive-foreground">
          {props.error}
        </p>
      )}
    </div>
  );
}

function hostPlaceholder(hosts: UseQueryResult<SshHostInfo[]>) {
  if (hosts.isPending) return '正在读取…';
  if (hosts.isError) return '读取失败';
  return hosts.data.length ? '请选择' : '没有可用的 Host';
}

function SshHostPicker({
  id,
  hosts,
  value,
  error,
  onChange,
}: {
  id: string;
  hosts: UseQueryResult<SshHostInfo[]>;
  value: string;
  error?: string;
  onChange(value: string): void;
}) {
  const selected = hosts.data?.find((host) => host.alias === value);
  const hint = selected?.unsupported.length
    ? `该 Host 使用了暂不支持的选项：${selected.unsupported.join('、')}`
    : '读取本机 ~/.ssh/config 中的 Host 别名。';
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FormField
        id={id}
        label="服务器 Host"
        error={error ?? (hosts.isError ? '无法读取 SSH 配置，请检查本地后端并重新读取。' : undefined)}
        hint={hint}
      >
        {({ describedBy }) => (
          <select
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error || hosts.isError ? true : undefined}
            aria-describedby={describedBy}
            className={inputClass}
            disabled={hosts.isPending}
          >
            <option value="">{hostPlaceholder(hosts)}</option>
            {hosts.data?.map((host) => (
              <option key={host.alias} value={host.alias}>
                {host.alias}
              </option>
            ))}
          </select>
        )}
      </FormField>
      {hosts.isSuccess && hosts.data.length === 0 && (
        <p className="text-xs leading-5 text-muted-foreground">请先在本机 SSH 配置中添加 Host，再重新读取。</p>
      )}
      <button
        type="button"
        className={`${buttonClass('ghost')} self-start active:bg-muted`}
        disabled={hosts.isFetching}
        onClick={() => void hosts.refetch()}
      >
        <RefreshCw aria-hidden className="size-3.5" />
        {hosts.isFetching ? '正在读取 Host…' : '重新读取 Host'}
      </button>
    </div>
  );
}

function AuthenticationField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: SshAuthMode;
  onChange(value: SshAuthMode): void;
}) {
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <legend className="mb-3 text-sm font-medium">SSH 认证方式</legend>
      {AUTH_MODES.map(({ mode, label }) => (
        <label
          key={mode}
          className={`flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted ${value === mode ? 'border-accent/60 bg-accent/10' : 'border-border-strong'}`}
        >
          <input
            type="radio"
            name={`${id}-authMode`}
            value={mode}
            checked={value === mode}
            onChange={() => onChange(mode)}
            className="size-4 shrink-0 accent-accent"
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

function isTestDisabled(values: Values, connection: ReturnType<typeof useSshConnection>, creating: boolean) {
  const needsPassword = values.authMode === 'password' && !connection.hasPassword && !connection.saved;
  return creating || connection.busy || !values.sshHost || needsPassword;
}

/** 工作区配置不含密码；密码工作区须先完成同一目标的连接验证。 */
export function WorkspaceForm({
  onCreated,
  onCancel,
  onBusyChange,
}: {
  onCreated(ws: Workspace): void;
  onCancel(): void;
  onBusyChange?(busy: boolean): void;
}) {
  const id = useId();
  const qc = useQueryClient();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const hosts = useQuery({ queryKey: queryKeys.sshHosts, queryFn: api.listSshHosts });
  const target = { sshHost: values.sshHost, remoteDir: values.remoteDir, authMode: values.authMode };
  const connection = useSshConnection(target);

  const create = useMutation({
    mutationFn: (input: WorkspaceInput) => api.createWorkspace(input),
    onSuccess: async (workspace) => {
      if (mounted.current) connection.clearPassword();
      await qc.invalidateQueries({ queryKey: queryKeys.workspaces });
      // 表单已销毁时只刷新列表，不让迟到创建结果切换当前工作区。
      if (mounted.current) onCreated(workspace);
    },
    onError: (error) => {
      if (!mounted.current) return;
      connection.clearPassword();
      if (error instanceof ApiError && error.status === 409) connection.reset();
      const field = error instanceof ApiError ? (error.field as Field | undefined) : undefined;
      const found = field && field in EMPTY ? { [field]: error.message } : { form: error.message };
      setErrors(found);
      focusError(id, found);
    },
  });
  const busy = create.isPending || connection.busy;
  const needsVerification = values.authMode === 'password' && !connection.verified;
  useEffect(() => {
    // 连接测试可取消；只有工作区正在提交创建时阻止模态关闭。
    onBusyChange?.(create.isPending);
  }, [create.isPending, onBusyChange]);

  const set = (field: Field) => (value: string) => {
    if (field === 'sshHost' || field === 'remoteDir') connection.reset();
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };
  const setAuthMode = (authMode: SshAuthMode) => {
    connection.reset();
    setValues((current) => ({ ...current, authMode }));
    setErrors((current) => ({ ...current, form: undefined }));
  };
  const testConnection = () => {
    const found = sshTargetErrors(target);
    setErrors((current) => ({ ...current, sshHost: found.sshHost, remoteDir: found.remoteDir, form: undefined }));
    focusError(id, found);
    if (Object.keys(found).length === 0) void connection.connect();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const found = validate(values);
    if (needsVerification) found.form = '请先用当前 Host、认证方式和目录测试连接，再创建工作区。';
    setErrors(found);
    focusError(id, found);
    if (Object.keys(found).length === 0) create.mutate({ ...values, name: values.name.trim() });
  };
  const cancel = () => {
    if (create.isPending) return;
    connection.reset();
    onCancel();
  };
  const field = (name: Field) => ({
    id: `${id}-${name}`,
    value: values[name],
    'aria-invalid': errors[name] ? true : undefined,
    onChange: (event: { target: { value: string } }) => set(name)(event.target.value),
    className: inputClass,
  });

  return (
    <form noValidate onSubmit={submit} aria-label="新建工作区" aria-busy={busy} className="flex min-w-0 flex-col gap-5">
      <p className="text-sm leading-6 text-muted-foreground">为项目关联本地副本与 SSH 服务器目录。</p>
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5 disabled:opacity-70">
        <legend className="sr-only">工作区配置</legend>
        <FormField id={`${id}-name`} label="工作区名称" error={errors.name}>
          {({ describedBy }) => (
            <input {...field('name')} aria-describedby={describedBy} autoComplete="off" autoFocus />
          )}
        </FormField>
        <FormField
          id={`${id}-localDir`}
          label="本地文件夹"
          error={errors.localDir}
          hint="已存在的绝对路径，如 E:\projects\demo"
        >
          {({ describedBy }) => (
            <input
              {...field('localDir')}
              aria-describedby={describedBy}
              className={`${inputClass} font-mono`}
              spellCheck={false}
            />
          )}
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <SshHostPicker
            id={`${id}-sshHost`}
            hosts={hosts}
            value={values.sshHost}
            error={errors.sshHost}
            onChange={set('sshHost')}
          />
          <FormField id={`${id}-remoteDir`} label="服务器目录" error={errors.remoteDir} hint="以 / 或 ~ 开头">
            {({ describedBy }) => (
              <input
                {...field('remoteDir')}
                aria-describedby={describedBy}
                className={`${inputClass} font-mono`}
                spellCheck={false}
              />
            )}
          </FormField>
        </div>
        <AuthenticationField id={id} value={values.authMode} onChange={setAuthMode} />
        {values.authMode === 'password' ? (
          <SshPasswordField connection={connection} disabled={busy} />
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            使用本机已有私钥；可先测试认证与目录，再创建工作区。
          </p>
        )}
      </fieldset>
      <button
        type="button"
        className={`${buttonClass('outline')} self-start active:bg-muted`}
        onClick={testConnection}
        disabled={isTestDisabled(values, connection, create.isPending)}
      >
        <PlugZap aria-hidden className="size-4" />
        {connection.busy ? '正在测试连接…' : '测试连接'}
      </button>
      <SshConnectionFeedback connection={connection} />
      {needsVerification && (
        <p className="text-xs leading-5 text-warning">密码认证须先验证成功，才能创建。目标改变后需要重新测试。</p>
      )}
      {errors.form && (
        <p role="alert" className="text-xs leading-5 text-destructive-foreground">
          {errors.form}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
        <button
          type="button"
          className={`${buttonClass('ghost')} active:bg-muted`}
          onClick={cancel}
          disabled={create.isPending}
        >
          取消
        </button>
        <button
          type="submit"
          className={`${buttonClass('primary')} active:bg-accent/80`}
          disabled={busy || needsVerification}
        >
          {create.isPending ? '创建中…' : '创建工作区'}
        </button>
      </div>
    </form>
  );
}
