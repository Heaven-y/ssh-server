import { useId } from 'react';
import { inputClass } from '../../ui/styles';
import type { useSshConnection } from './use-ssh-connection';

export function SshPasswordField({
  connection: {
    passwordRef: inputRef,
    passwordChanged,
    saved,
    savePassword,
    loadingCredentials,
    savingAvailable,
    changeSaving,
  },
  disabled = false,
  autoFocus = false,
}: {
  connection: ReturnType<typeof useSshConnection>;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        SSH 密码
      </label>
      <input
        id={id}
        ref={inputRef}
        type="password"
        autoComplete="current-password"
        autoFocus={autoFocus}
        aria-describedby={`${id}-hint`}
        className={inputClass}
        disabled={disabled}
        onChange={passwordChanged}
        placeholder={saved ? '留空使用已保存密码' : undefined}
      />
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
        {saved
          ? '已在本机加密保存，连接时可留空；输入新密码可替换。'
          : '发送后立即清空。未保存时，断开或重启后需重新输入。'}
      </p>
      <label className="flex min-h-9 items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={savePassword}
          disabled={disabled || loadingCredentials || (!savingAvailable && !saved)}
          onChange={(event) => changeSaving(event.target.checked)}
          aria-describedby={`${id}-saving-hint`}
          className="size-4 shrink-0 accent-accent"
        />
        保存密码
      </label>
      <p id={`${id}-saving-hint`} className="text-xs leading-5 text-muted-foreground">
        {savingHint({ saved, loadingCredentials, savingAvailable })}
      </p>
    </div>
  );
}

function savingHint(
  connection: Pick<ReturnType<typeof useSshConnection>, 'saved' | 'loadingCredentials' | 'savingAvailable'>,
) {
  if (connection.loadingCredentials) return '正在读取本机保存状态…';
  if (connection.saved) return '取消勾选会清除本机保存的密码并断开该服务器连接。';
  if (!connection.savingAvailable) return '当前系统无法加密保存，仍可使用临时密码连接。';
  return '连接验证成功后由 Windows 当前用户加密保存，断开或重启后可复用。';
}
