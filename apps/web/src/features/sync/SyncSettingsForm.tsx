import { useId, useState, type FormEvent } from 'react';
import { SyncSettingsSchema, type SyncSettings } from '@ssh-server/shared';
import { buttonClass, inputClass } from '../../ui/styles';

export function SyncSettingsForm({
  settings,
  busy,
  save,
  defaultOpen = false,
  saveLabel = '保存规则',
  onDirtyChange,
}: {
  settings: SyncSettings;
  busy: boolean;
  save(settings: SyncSettings): void;
  defaultOpen?: boolean;
  saveLabel?: string;
  onDirtyChange?(dirty: boolean): void;
}) {
  const id = useId();
  const [size, setSize] = useState(String(settings.maxFileBytes / 1024 / 1024));
  const [extensions, setExtensions] = useState(settings.excludedExtensions.join(', '));
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = SyncSettingsSchema.safeParse({
      maxFileBytes: Math.round(Number(size) * 1024 * 1024),
      excludedExtensions: extensions.split(/[,\s]+/).filter(Boolean),
    });
    if (!parsed.success) {
      setError('上限须为 1 字节到 100 MiB；扩展名只填写英文字母或数字，用逗号分隔。');
      return;
    }
    setError('');
    onDirtyChange?.(false);
    save(parsed.data);
  };
  return (
    <details open={defaultOpen || undefined} className="mt-2 text-xs">
      <summary className="w-fit cursor-pointer rounded px-1 py-2 text-muted-foreground">同步过滤设置</summary>
      <form
        aria-label="同步过滤设置"
        onSubmit={submit}
        className="mt-2 grid max-w-2xl gap-3 sm:grid-cols-[160px_minmax(0,1fr)]"
      >
        <div>
          <label htmlFor={`${id}-size`} className="mb-1 block text-muted-foreground">
            单文件上限（MiB）
          </label>
          <input
            id={`${id}-size`}
            className={inputClass}
            type="number"
            min={1 / 1024 / 1024}
            max="100"
            step="any"
            value={size}
            disabled={busy}
            onChange={(event) => {
              setSize(event.target.value);
              onDirtyChange?.(true);
            }}
            required
          />
        </div>
        <div>
          <label htmlFor={`${id}-extensions`} className="mb-1 block text-muted-foreground">
            排除的扩展名
          </label>
          <input
            id={`${id}-extensions`}
            className={inputClass}
            value={extensions}
            disabled={busy}
            onChange={(event) => {
              setExtensions(event.target.value);
              onDirtyChange?.(true);
            }}
          />
        </div>
        <p className="leading-5 text-muted-foreground sm:col-span-2">
          .git 始终排除。修改规则后需要确认重建基线，大数据与权重留在服务器。
        </p>
        {error && (
          <p role="alert" className="text-destructive-foreground sm:col-span-2">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={`${buttonClass('outline')} w-fit`}>
          {saveLabel}
        </button>
      </form>
    </details>
  );
}
