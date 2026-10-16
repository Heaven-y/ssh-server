import { useId } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { buttonClass, inputClass } from '../../ui/styles';
import type { useServerPasswordEditor } from './use-server-password-editor';

type Editor = ReturnType<typeof useServerPasswordEditor>;
function PasswordInput({
  editor: { passwordRef: inputRef, visible, ready, savingAvailable, identityChanged, change, toggle },
  busy,
}: {
  editor: Editor;
  busy: boolean;
}) {
  const id = useId();
  const disabled = busy || !ready || !savingAvailable;
  const Icon = visible ? EyeOff : Eye;
  return (
    <>
      <label htmlFor={id} className="block text-sm">
        SSH 密码
      </label>
      <div className="flex min-w-0 gap-2">
        <input
          id={id}
          ref={inputRef}
          type={visible ? 'text' : 'password'}
          autoComplete="current-password"
          spellCheck={false}
          maxLength={4096}
          aria-describedby={`${id}-hint`}
          className={`${inputClass} min-w-0 flex-1`}
          disabled={disabled}
          onChange={change}
        />
        <button
          type="button"
          className={`${buttonClass('outline')} min-h-11 min-w-11 shrink-0`}
          aria-label={visible ? '隐藏密码' : '显示密码'}
          aria-pressed={visible}
          disabled={disabled}
          onClick={toggle}
        >
          <Icon aria-hidden className="size-4" />
        </button>
      </div>
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
        已保存密码会填入此字段；清空后确认保存将清除保存的密码。
      </p>
      {identityChanged && <p className="text-sm text-warning">连接目标已改变，旧密码已清空；如需密码请重新输入。</p>}
      {!savingAvailable && ready && (
        <p className="text-sm text-warning">本机系统加密不可用；可仅保存档案，连接时使用临时密码。</p>
      )}
    </>
  );
}
export function ServerPasswordEditor({
  editor,
  passwordMode,
  busy,
}: {
  editor: Editor;
  passwordMode: boolean;
  busy: boolean;
}) {
  return (
    <div className="min-w-0 space-y-2 sm:col-span-2">
      {passwordMode && <PasswordInput editor={editor} busy={busy} />}
      {editor.phase === 'loading' && (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取服务器编辑信息与本机保存密码…
        </p>
      )}
      {editor.error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {editor.error}
        </p>
      )}
      {editor.phase === 'reread' && !busy && (
        <button type="button" className={buttonClass('outline')} onClick={editor.reread}>
          重新读取编辑信息
        </button>
      )}
    </div>
  );
}
