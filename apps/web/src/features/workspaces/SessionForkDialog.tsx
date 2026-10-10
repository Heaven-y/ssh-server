import { useEffect, useRef } from 'react';
import type { SessionSummary } from '@ssh-server/shared';
import { useQueryClient } from '@tanstack/react-query';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass } from '../../ui/styles';
import { queryKeys } from '../../lib/api';
import { sessionActionKey, useChat } from '../chat/chat-store';
import { AGENT_LABELS } from '../chat/AgentControls';
import { forkSession } from './session-fork';

type Props = {
  workspaceId: string;
  session: SessionSummary;
  pointId?: string;
  onClose(): void;
};
export function SessionForkDialog({ workspaceId, session, pointId, onClose }: Props) {
  const client = useQueryClient();
  const key = sessionActionKey(workspaceId, session);
  const operation = useChat((state) => state.sessionOperations[key]);
  const running = useChat(
    (state) =>
      state.workspaceId === workspaceId &&
      state.agent === session.agent &&
      state.sessionId === session.sessionId &&
      state.running,
  );
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
    <DetailDialog title="分叉会话" busy={busy} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm font-medium wrap-anywhere">
          {session.summary || '无标题会话'} · {AGENT_LABELS[session.agent]}
        </p>
        <p className="text-sm leading-6">
          {pointId ? '保留截至所选位置的原生历史（包含该位置），创建独立会话。' : '从原生会话末尾创建独立会话。'}
        </p>
        <p className="text-xs leading-6 text-muted-foreground">
          源会话保持不变，不会回滚项目文件。分叉后继续对话仍使用当前工作区文件。
        </p>
        {pointId && <p className="text-xs break-all text-muted-foreground">原生分叉点：{pointId}</p>}
        {running && (
          <p role="status" className="text-sm text-warning">
            源会话正在运行，结束后才能分叉。
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            正在创建原生分叉，请等待结果…
          </p>
        )}
        {operation?.error && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive-foreground">
              {operation.error}
            </p>
            <p className="text-xs leading-6 text-muted-foreground">
              请求未确认时分叉可能已创建；重试前请重新读取原生列表核对。
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
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className={buttonClass('primary')} disabled={busy || running} onClick={submit}>
            确认分叉
          </button>
        </div>
      </div>
    </DetailDialog>
  );
}
