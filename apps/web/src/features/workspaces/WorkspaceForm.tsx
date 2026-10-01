import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { WorkspaceInputSchema, type Workspace, type WorkspaceInput } from '@ssh-server/shared';
import { api, ApiError, queryKeys } from '../../lib/api';
import { buttonClass, inputClass } from '../../ui/styles';

type Field = 'name' | 'localDir' | 'sshHost' | 'remoteDir';
type Errors = Partial<Record<Field | 'form', string>>;

const EMPTY: Record<Field, string> = { name: '', localDir: '', sshHost: '', remoteDir: '~' };

/** 先用共享 schema 在前端校验，路径是否存在、Host 是否已配置由后端校验 */
function validate(values: Record<Field, string>): Errors {
  const r = WorkspaceInputSchema.safeParse(values);
  if (r.success) return {};
  const errors: Errors = {};
  for (const issue of r.error.issues) {
    const field = issue.path[0] as Field;
    errors[field] ??= field === 'name' ? '请填写名称（不超过 100 字）' : issue.message.startsWith('Too small') ? '必填' : issue.message;
  }
  return errors;
}

function FormField(props: { id: string; label: string; error?: string; hint?: string; children: (a: { describedBy?: string }) => ReactNode }) {
  const errId = `${props.id}-err`;
  const hintId = `${props.id}-hint`;
  const describedBy = [props.error && errId, props.hint && hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.id} className="text-xs font-medium text-muted-foreground">
        {props.label}
      </label>
      {props.children({ describedBy })}
      {props.hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={errId} className="text-xs text-destructive-foreground">
          {props.error}
        </p>
      )}
    </div>
  );
}

/** 新建工作区（M1 为简单表单，完整向导在 M5） */
export function WorkspaceForm({ onCreated, onCancel }: { onCreated(ws: Workspace): void; onCancel(): void }) {
  const id = useId();
  const qc = useQueryClient();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const hosts = useQuery({ queryKey: queryKeys.sshHosts, queryFn: api.listSshHosts });

  const create = useMutation({
    mutationFn: (input: WorkspaceInput) => api.createWorkspace(input),
    onSuccess: async (ws) => {
      await qc.invalidateQueries({ queryKey: queryKeys.workspaces });
      onCreated(ws);
    },
    onError: (e) => {
      const field = e instanceof ApiError ? (e.field as Field | undefined) : undefined;
      setErrors(field && field in EMPTY ? { [field]: e.message } : { form: e.message });
    },
  });

  const set = (field: Field) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length === 0) create.mutate({ ...values, name: values.name.trim() });
  };

  const selected = hosts.data?.find((h) => h.alias === values.sshHost);
  const field = (f: Field) => ({
    id: `${id}-${f}`,
    value: values[f],
    'aria-invalid': errors[f] ? true : undefined,
    onChange: (e: { target: { value: string } }) => set(f)(e.target.value),
    className: inputClass,
  });

  return (
    <form noValidate onSubmit={submit} aria-label="新建工作区" className="flex flex-col gap-3 rounded-md border border-border p-3">
      <FormField id={`${id}-name`} label="名称" error={errors.name}>
        {({ describedBy }) => <input {...field('name')} aria-describedby={describedBy} autoComplete="off" />}
      </FormField>

      <FormField id={`${id}-localDir`} label="本地文件夹" error={errors.localDir} hint="已存在的绝对路径，如 E:\projects\demo">
        {({ describedBy }) => <input {...field('localDir')} aria-describedby={describedBy} className={`${inputClass} font-mono`} spellCheck={false} />}
      </FormField>

      <FormField
        id={`${id}-sshHost`}
        label="服务器（~/.ssh/config 中的 Host）"
        error={errors.sshHost ?? (hosts.isError ? hosts.error.message : undefined)}
        hint={selected?.unsupported.length ? `该 Host 使用了暂不支持的选项：${selected.unsupported.join('、')}` : undefined}
      >
        {({ describedBy }) => (
          <select {...field('sshHost')} aria-describedby={describedBy} disabled={hosts.isPending}>
            <option value="">{hosts.isPending ? '正在读取…' : hosts.data?.length ? '请选择' : '没有可用的 Host'}</option>
            {hosts.data?.map((h) => (
              <option key={h.alias} value={h.alias}>
                {h.alias}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <FormField id={`${id}-remoteDir`} label="服务器目录" error={errors.remoteDir} hint="以 / 或 ~ 开头">
        {({ describedBy }) => <input {...field('remoteDir')} aria-describedby={describedBy} className={`${inputClass} font-mono`} spellCheck={false} />}
      </FormField>

      {errors.form && (
        <p role="alert" className="text-xs text-destructive-foreground">
          {errors.form}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClass('ghost')} onClick={onCancel}>
          取消
        </button>
        <button type="submit" className={buttonClass('primary')} disabled={create.isPending}>
          {create.isPending ? '创建中…' : '创建'}
        </button>
      </div>
    </form>
  );
}
