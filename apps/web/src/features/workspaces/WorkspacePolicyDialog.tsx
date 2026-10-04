import { RefreshCw, Save } from 'lucide-react';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass } from '../../ui/styles';
import { WorkspacePolicyForm } from './WorkspacePolicyForm';
import { useWorkspacePolicy } from './use-workspace-policy';

export default function WorkspacePolicyDialog({
  workspaceId,
  name,
  onClose,
}: {
  workspaceId: string;
  name: string;
  onClose(): void;
}) {
  const { prefix, summary, draft, setDraft, phase, message, errors, busy, canSave, save, reread, close } =
    useWorkspacePolicy(workspaceId, onClose);
  return (
    <DetailDialog title={`命令规则：${name}`} busy={phase === 'saving'} onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="flex flex-col gap-5"
      >
        <p className="text-sm leading-6 text-muted-foreground">
          规则用于防止Agent远程执行的误操作，不能防止刻意绕过；网页终端不受此规则约束。已通过检查的在途命令继续执行。
        </p>
        {phase === 'loading' && <p role="status">正在读取命令规则…</p>}
        {message && (
          <p
            role={phase === 'error' ? 'alert' : 'status'}
            className={`text-sm ${phase === 'error' ? 'text-destructive-foreground' : 'text-muted-foreground'}`}
          >
            {message}
          </p>
        )}
        {errors.length > 0 && (
          <div
            ref={summary}
            role="alert"
            tabIndex={-1}
            className="rounded-md bg-destructive/10 p-3 text-sm text-destructive-foreground"
          >
            <p>请检查以下字段：</p>
            <ul className="list-inside list-disc">
              {errors.map((error, index) => (
                <li key={`${error.path}-${index}`}>
                  <a className="underline" href={`#${prefix}-${error.path}`}>
                    {error.message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {draft && (
          <fieldset disabled={phase === 'saving'}>
            <WorkspacePolicyForm draft={draft} setDraft={setDraft} errors={errors} prefix={prefix} />
          </fieldset>
        )}
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <button type="button" className={buttonClass()} disabled={busy} onClick={reread}>
            <RefreshCw aria-hidden className="size-4" />
            重新读取
          </button>
          <button type="submit" className={buttonClass('primary')} disabled={!canSave}>
            <Save aria-hidden className="size-4" />
            {phase === 'saving' ? '正在保存…' : '保存规则'}
          </button>
        </footer>
      </form>
    </DetailDialog>
  );
}
