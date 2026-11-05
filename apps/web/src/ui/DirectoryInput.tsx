import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { desktopDirectoryPicker } from '../lib/desktop-bridge';
import { buttonClass, inputClass } from './styles';

type Props = {
  id: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
};

export function DirectoryInput({ id, value, onChange, disabled, placeholder, autoFocus }: Props) {
  const selectDirectory = desktopDirectoryPicker();
  const request = useRef<{ active: boolean } | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // 路径或可编辑状态变化后，旧对话框结果不再拥有本输入框。
  useEffect(
    () => () => {
      if (request.current) request.current.active = false;
    },
    [value, disabled],
  );
  const choose = async () => {
    if (!selectDirectory || request.current || disabled) return;
    const current = { active: true };
    request.current = current;
    setBusy(true);
    setError('');
    try {
      const selected = await selectDirectory(value);
      if (current.active && selected !== null) onChange(selected);
    } catch {
      if (current.active) setError('无法打开文件夹选择窗口，请重试或输入路径。');
    } finally {
      if (mounted.current && request.current === current) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={value}
          onChange={(event) => {
            setError('');
            onChange(event.target.value);
          }}
          placeholder={placeholder}
          className={`${inputClass} min-w-0 font-mono text-xs`}
          autoFocus={autoFocus}
          required
          disabled={disabled || busy}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {selectDirectory && (
          <button
            type="button"
            className={`${buttonClass()} shrink-0`}
            disabled={disabled || busy}
            onClick={() => void choose()}
          >
            <FolderOpen aria-hidden className="size-4" />
            {busy ? '选择中…' : '选择文件夹'}
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs leading-5 text-destructive-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
