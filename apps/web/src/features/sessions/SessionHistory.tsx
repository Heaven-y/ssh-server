import { useQueryClient } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import type { AgentKind, SessionSummary } from '@agentdeck/shared';
import { queryKeys } from '../../lib/api';
import { useChat } from '../chat/chat-store';
import { agentVersion, useEnvironment } from '../settings/use-environment';
import { SessionHeader } from './SessionHeader';
import { SessionTimeline } from './SessionTimeline';
import { useSessionHistory } from './use-sessions';

function SelectSession() {
  return (
    <div className="m-auto max-w-md px-6 py-12 text-center">
      <MessagesSquare aria-hidden className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-3 text-base font-medium">选择一条会话查看历史</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        左栏按项目与 CLI 列出原生会话。M1 只读：读历史，不发消息。
      </p>
    </div>
  );
}

/**
 * 只读会话视图：会话头 + 原生历史时间线。
 * 会话身份（CLI + 原生 id）来自 chat store 的选择，正文由 react-query 单独读取，
 * 这样不可回放的错误码不会被实时对话的通用错误横幅吞掉。
 */
export function SessionHistory({ projectId, projectDir }: { projectId: string; projectDir: string }) {
  const agent = useChat((state) => state.agent);
  const sessionId = useChat((state) => state.sessionId);
  if (!sessionId) return <SelectSession />;
  return <SelectedSession projectId={projectId} projectDir={projectDir} agent={agent} sessionId={sessionId} />;
}

function SelectedSession({
  projectId,
  projectDir,
  agent,
  sessionId,
}: {
  projectId: string;
  projectDir: string;
  agent: AgentKind;
  sessionId: string;
}) {
  const client = useQueryClient();
  const environment = useEnvironment();
  const { history, failure, notReplayable, loading, retry } = useSessionHistory(projectId, { agent, sessionId });
  // 标题优先用原生会话记录；读取中退到左栏已缓存的列表摘要，避免先闪一下「未命名会话」。
  const cached = client.getQueryData<SessionSummary[]>(queryKeys.sessions(projectId, agent));
  const summary = cached?.find((session) => session.sessionId === sessionId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionHeader
        agent={agent}
        title={history?.session.summary || summary?.title || ''}
        version={agentVersion(environment.data, agent)}
        projectDir={projectDir}
        running={summary?.running}
      />
      <SessionTimeline
        events={history?.events ?? []}
        notReplayable={notReplayable}
        error={failure}
        loading={loading}
        onRetry={retry}
      />
    </div>
  );
}
