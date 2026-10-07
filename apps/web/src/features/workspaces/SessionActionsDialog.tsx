import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionActionInput, SessionSummary } from '@ssh-server/shared';
import { queryKeys } from '../../lib/api';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass, inputClass } from '../../ui/styles';
import { AGENT_LABELS } from '../chat/AgentControls';
import { sessionActionKey, useChat } from '../chat/chat-store';
import { useSessionModel } from '../chat/use-session-model';

type Action = SessionActionInput['action'];
const ACTION_LABELS: Record<Action, string> = { rename: '重命名', delete: '删除', archive: '归档', unarchive: '恢复' };
type Props = {
  workspaceId: string;
  session: SessionSummary;
  archived: boolean;
  onClose(): void;
  onCompleted(action: Action): void;
};
type Submit = (input: SessionActionInput) => void;

function RenameSession({ session, submit }: { session: SessionSummary; submit: Submit }) {
  const id = useId();
  const [title, setTitle] = useState(session.summary);
  const canRename = title.trim().length > 0 && title.trim() !== session.summary.trim();
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canRename) submit({ action: 'rename', title: title.trim() });
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        会话名称
        <input
          id={id}
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          className={`${inputClass} mt-2`}
        />
      </label>
      <div className="flex justify-end">
        <button type="submit" className={buttonClass('primary')} disabled={!canRename}>
          保存名称
        </button>
      </div>
    </form>
  );
}
function ArchiveSession({ archived, submit }: { archived: boolean; submit: Submit }) {
  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label={archived ? '恢复会话' : '归档会话'}>
      <h3 className="text-sm font-medium">{archived ? '恢复会话' : '归档会话'}</h3>
      <p className="text-xs leading-6 text-muted-foreground">
        {archived
          ? '恢复后可从普通会话列表继续对话或重命名。恢复范围以原生运行时结果为准。'
          : '归档会影响这条 Codex 原生记录及其派生子会话。归档后可从“已归档”列表恢复。'}
      </p>
      <button
        type="button"
        className={buttonClass('outline')}
        onClick={() => submit({ action: archived ? 'unarchive' : 'archive' })}
      >
        {archived ? '恢复到会话列表' : '归档会话'}
      </button>
    </section>
  );
}
function DeleteSession({ submit }: { submit: Submit }) {
  const id = useId();
  const [confirmed, setConfirmed] = useState(false);
  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="删除会话">
      <h3 className="text-sm font-medium text-destructive-foreground">删除原生会话</h3>
      <p className="text-xs leading-6 text-muted-foreground">
        删除会影响本机原生记录及相关子会话。本网页不另存对话副本，无法从这里撤销删除。
      </p>
      <label htmlFor={id} className="flex items-start gap-2 text-sm leading-6">
        <input
          id={id}
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1 accent-accent"
        />
        我确认删除这条原生记录及相关子会话
      </label>
      <button
        type="button"
        className={buttonClass('danger')}
        disabled={!confirmed}
        onClick={() => {
          if (confirmed) submit({ action: 'delete', confirmed: true });
        }}
      >
        确认删除会话
      </button>
    </section>
  );
}
function SessionActionError({
  workspaceId,
  session,
  error,
}: {
  workspaceId: string;
  session: SessionSummary;
  error?: string;
}) {
  const client = useQueryClient();
  if (!error) return null;
  return (
    <div className="space-y-2">
      <p role="alert" className="text-sm leading-6 text-destructive-foreground">
        {error}
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        请求未确认时，操作可能已生效；可重新读取原生列表核对实际状态。
      </p>
      <button
        type="button"
        className={buttonClass('outline')}
        onClick={() => {
          void client.invalidateQueries({ queryKey: queryKeys.sessions(workspaceId, session.agent) });
        }}
      >
        重新读取列表
      </button>
    </div>
  );
}

export function SessionActionsDialog({ workspaceId, session, archived, onClose, onCompleted }: Props) {
  const key = sessionActionKey(workspaceId, session);
  const { description } = useSessionModel(workspaceId, session);
  const operation = useChat((state) => state.sessionOperations[key]);
  const manage = useChat((state) => state.manageSession);
  const running = useChat(
    (state) =>
      state.workspaceId === workspaceId &&
      state.agent === session.agent &&
      state.sessionId === session.sessionId &&
      state.running,
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = operation?.pending === true;
  const submit: Submit = (input) => {
    if (busy || running) return;
    void manage(workspaceId, session, input).then((completed) => {
      if (completed && mounted.current) onCompleted(input.action);
    });
  };
  return (
    <DetailDialog title="会话管理" busy={busy} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium wrap-anywhere">{session.summary || '无标题会话'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            运行来源：{AGENT_LABELS[session.agent]}
            {archived ? ' · 已归档' : ''}
          </p>
          <p className="mt-1 text-xs leading-6 wrap-anywhere text-muted-foreground">{description}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            最后更新：
            <time dateTime={new Date(session.lastModified).toISOString()}>
              {new Date(session.lastModified).toLocaleString('zh-CN')}
            </time>
          </p>
        </div>
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            正在{ACTION_LABELS[operation.action]}原生会话，请等待结果…
          </p>
        )}
        {running && (
          <p role="status" className="text-sm text-warning">
            当前会话正在运行，结束后才能管理。
          </p>
        )}
        <SessionActionError workspaceId={workspaceId} session={session} error={operation?.error} />
        <fieldset disabled={busy || running} className="min-w-0 space-y-5">
          {!archived && <RenameSession session={session} submit={submit} />}
          {session.agent === 'codex' && <ArchiveSession archived={archived} submit={submit} />}
          <DeleteSession submit={submit} />
        </fieldset>
        <div className="flex justify-end border-t border-border pt-4">
          <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </DetailDialog>
  );
}
