import { buttonClass } from '../../ui/styles';

export function SettingsLoadError({
  error,
  retry,
  message,
}: {
  error: Error | null;
  retry(): unknown;
  message: string;
}) {
  if (!error) return null;
  return (
    <div role="alert" className="text-sm text-destructive-foreground">
      <p>
        {message}：{error.message}
      </p>
      <button type="button" className={buttonClass('outline')} onClick={() => void retry()}>
        重读产品设置
      </button>
    </div>
  );
}
