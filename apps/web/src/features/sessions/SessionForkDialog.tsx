import { sessionsKeys } from './api';
import { useEffect, useRef } from 'react';
import type { SessionRef } from '@agentdeck/shared/conversation';
import { useQueryClient } from '@tanstack/react-query';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass } from '../../ui/styles';

import { sessionActionKey, useChat } from '../chat/chat-store';
import { AGENT_LABELS } from '../../cli/shared/labels';
import { forkSession } from './session-fork';
import { useSessionBusy } from './use-session-busy';

type Props = {
  workspaceId: string;
  /** 分叉只需要原生身份与展示标题，列表行与会话头都能直接传。 */
  session: SessionRef & { title: string; running?: boolean };
  pointId?: string;
  onClose(): void;
};
export function SessionForkDialog({ workspaceId, session, pointId, onClose }: Props) {
  const client = useQueryClient();
  const key = sessionActionKey(workspaceId, session);
  const operation = useChat((state) => state.sessionOperations[key]);
  const { running } = useSessionBusy(workspaceId, session);
  const busy = operation?.pending === true;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = () => {
    if (busy || running) return;
    void forkSession(workspaceId, session, pointId ? { pointId } : {}).then((completed) => {
      if (completed && mounted.current) onClose();
    });
  };
  return (
    <DetailDialog title="创建分支" busy={busy} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm font-medium wrap-anywhere">
          {session.title || '无标题会话'} · {AGENT_LABELS[session.agent]}
        </p>
        <p className="text-sm leading-6">
          {pointId ? '保留截至所选位置的对话历史，创建独立会话。' : '从会话末尾创建独立会话。'}
        </p>
        <p className="text-xs leading-6 text-muted-foreground">源会话保持不变，使用同一项目目录。</p>
        {running && (
          <p role="status" className="text-sm text-warning">
            请先结束当前回合。
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            正在创建分支…
          </p>
        )}
        {operation?.error && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive-foreground">
              {operation.error}
            </p>
            <button
              type="button"
              className={buttonClass('outline')}
              onClick={() => {
                void client.invalidateQueries({ queryKey: sessionsKeys.sessions(workspaceId, session.agent) });
              }}
            >
              重新读取列表
            </button>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className={buttonClass('primary')} disabled={busy || running} onClick={submit}>
            创建分支
          </button>
        </div>
      </div>
    </DetailDialog>
  );
}
