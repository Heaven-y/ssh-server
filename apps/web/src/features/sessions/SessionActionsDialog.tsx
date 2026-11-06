import { sessionsKeys } from './api';
import { invalidateSessionPages } from './session-queries';
import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  legacySessionCapabilities,
  type SessionActionInput,
  type SessionSummary,
} from '@agentdeck/shared/conversation';

import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass, inputClass } from '../../ui/styles';
import { AGENT_LABELS } from '../../cli/shared/labels';
import { sessionActionKey, useChat } from '../chat/chat-store';
import { useSessionBusy } from './use-session-busy';

type Action = SessionActionInput['action'];
const ACTION_LABELS: Record<Action | 'fork', string> = {
  rename: '重命名',
  delete: '删除',
  archive: '归档',
  unarchive: '恢复',
  fork: '创建分支',
};
type Props = {
  workspaceId: string;
  session: SessionSummary;
  archived: boolean;
  action: Action;
  onClose(): void;
  onCompleted(action: Action): void;
};
type Submit = (input: SessionActionInput) => void;

function RenameSession({ session, submit }: { session: SessionSummary; submit: Submit }) {
  const id = useId();
  const [title, setTitle] = useState(session.title);
  const canRename = title.trim().length > 0 && title.trim() !== session.title.trim();
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
function ArchiveSession({ archived, local, submit }: { archived: boolean; local: boolean; submit: Submit }) {
  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label={archived ? '恢复会话' : '归档会话'}>
      <p className="text-xs leading-6 text-muted-foreground">
        {archived
          ? '恢复到工作区会话列表。'
          : local
            ? '移到工作台归档，CLI 中的记录保留。'
            : '移到已归档会话；由它启动的子会话也会归档。'}
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
function DeleteSession({ session, submit }: { session: SessionSummary; submit: Submit }) {
  const id = useId();
  const [confirmed, setConfirmed] = useState(false);
  const description = {
    codex: '删除本机记录及由它启动的子会话，无法撤销。',
    claude: '删除本机会话及其子代理记录，无法撤销。',
    antigravity: '删除这条本机会话记录，无法撤销。',
  }[session.agent];
  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="删除会话">
      <p className="text-xs leading-6 text-muted-foreground">{description}</p>
      <label htmlFor={id} className="flex items-start gap-2 text-sm leading-6">
        <input
          id={id}
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1 accent-accent"
        />
        确认删除
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
      <button
        type="button"
        className={buttonClass('outline')}
        onClick={() => {
          void client.invalidateQueries({ queryKey: sessionsKeys.sessions(workspaceId, session.agent) });
          void client.invalidateQueries({ queryKey: sessionsKeys.archivedSessions(session.agent) });
          void invalidateSessionPages(client, { queryKey: ['sessions', 'pages', session.agent] });
        }}
      >
        重新读取列表
      </button>
    </div>
  );
}

function SessionActionForm({
  action,
  session,
  archived,
  submit,
}: Pick<Props, 'action' | 'session' | 'archived'> & { submit: Submit }) {
  switch (action) {
    case 'rename':
      return archived ? null : <RenameSession session={session} submit={submit} />;
    case 'archive':
    case 'unarchive':
      return (
        <ArchiveSession
          archived={action === 'unarchive'}
          local={(session.capabilities ?? legacySessionCapabilities(session.agent)).archive === 'workbench'}
          submit={submit}
        />
      );
    case 'delete':
      return <DeleteSession session={session} submit={submit} />;
  }
}

export function SessionActionsDialog({ workspaceId, session, archived, action, onClose, onCompleted }: Props) {
  const key = sessionActionKey(workspaceId, session);
  const operation = useChat((state) => state.sessionOperations[key]);
  const manage = useChat((state) => state.manageSession);
  const { running } = useSessionBusy(workspaceId, session);
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
    <DetailDialog title={`${ACTION_LABELS[action]}会话`} busy={busy} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium wrap-anywhere">{session.title || '无标题会话'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {AGENT_LABELS[session.agent]}
            {archived ? ' · 已归档' : ''}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            最后更新：
            <time dateTime={session.updatedAt}>{new Date(session.updatedAt).toLocaleString('zh-CN')}</time>
          </p>
        </div>
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            正在{ACTION_LABELS[operation.action]}…
          </p>
        )}
        {running && (
          <p role="status" className="text-sm text-warning">
            当前会话正在运行，结束后才能管理。
          </p>
        )}
        <SessionActionError workspaceId={workspaceId} session={session} error={operation?.error} />
        <fieldset disabled={busy || running} className="min-w-0 space-y-5">
          <SessionActionForm action={action} session={session} archived={archived} submit={submit} />
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
