import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass } from '../../ui/styles';

export function TerminalPasteDialog({
  text,
  confirm,
  cancel,
}: {
  text: string;
  confirm: () => void;
  cancel: () => void;
}) {
  return (
    <DetailDialog title="确认多行粘贴" onClose={cancel}>
      <p className="text-sm text-warning">内容包含换行，粘贴到 shell 后可能立即执行。请确认以下内容。</p>
      <pre className="my-3 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 font-mono text-xs">
        {text}
      </pre>
      <p className="text-xs text-muted-foreground">原样发送，不额外追加 Enter。发送后无法撤回。</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={buttonClass('outline')} onClick={cancel}>
          取消
        </button>
        <button type="button" className={buttonClass('primary')} onClick={confirm}>
          确认粘贴
        </button>
      </div>
    </DetailDialog>
  );
}
