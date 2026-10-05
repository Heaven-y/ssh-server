import { Command } from 'cmdk';
import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import type { AgentKind, SessionSummary, Workspace } from '@ssh-server/shared';
import { DetailDialog } from '../ui/DetailDialog';
import { api, queryKeys } from '../lib/api';
import { sessionActionKey, useChat } from '../features/chat/chat-store';
import { useUiPreferences } from '../ui/ui-preferences';

export type PaletteActions = {
  files(): boolean;
  terminal(): boolean;
  settings(): boolean;
  sync(id: string): boolean;
  versions(id: string): boolean;
  resources(id: string): boolean;
};
type Action = { id: string; label: string; workspace?: boolean; run(): boolean };
const itemClass =
  'flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm data-[selected=true]:bg-muted data-[selected=true]:text-foreground data-[disabled=true]:opacity-45';
function commonActions(actions: PaletteActions, id: string): Action[] {
  return [
    {
      id: 'new',
      label: '新会话',
      workspace: true,
      run: () => {
        useChat.getState().newSession();
        return true;
      },
    },
    { id: 'files', label: '打开文件', workspace: true, run: actions.files },
    { id: 'terminal', label: '打开终端', workspace: true, run: actions.terminal },
    { id: 'sync', label: '立即同步', workspace: true, run: () => actions.sync(id) },
    { id: 'versions', label: '保存版本（填写说明）', workspace: true, run: () => actions.versions(id) },
    { id: 'resources', label: '查看资源详情', workspace: true, run: () => actions.resources(id) },
    { id: 'settings', label: '打开设置', run: actions.settings },
    {
      id: 'theme',
      label: '切换亮色 / 暗色主题',
      run: () => {
        useUiPreferences.getState().toggleTheme();
        return true;
      },
    },
    {
      id: 'sidebar',
      label: '折叠 / 展开侧栏',
      run: () => {
        const state = useUiPreferences.getState();
        state.setSidebarCollapsed(!state.sidebarCollapsed);
        return true;
      },
    },
  ];
}
function SessionSource({
  agent,
  workspaceId,
  sessions,
  choose,
}: {
  agent: AgentKind;
  workspaceId: string;
  sessions: SessionSummary[];
  choose(session: SessionSummary): void;
}) {
  const operations = useChat((state) => state.sessionOperations);
  return (
    <Command.Group heading={`${agent === 'claude' ? 'Claude' : 'Codex'} 会话`}>
      {sessions.map((session) => (
        <Command.Item
          key={session.sessionId}
          value={`session:${agent}:${session.sessionId}`}
          keywords={[session.summary, agent, session.sessionId]}
          className={itemClass}
          disabled={operations[sessionActionKey(workspaceId, session)]?.pending === true}
          onSelect={() => choose(session)}
        >
          <span className="truncate">{session.summary || '无标题会话'}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{agent}</span>
        </Command.Item>
      ))}
    </Command.Group>
  );
}
function PaletteSessions({ workspace, choose }: { workspace?: Workspace; choose(session: SessionSummary): void }) {
  const sources = useQueries({
    queries: (['claude', 'codex'] as const).map((agent) => ({
      queryKey: queryKeys.sessions(workspace?.id ?? '', agent),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.listSessions(workspace!.id, agent, false, signal),
      enabled: !!workspace,
      retry: false,
    })),
  });
  if (!workspace) return null;
  return (
    <>
      {sources.map((query, index) => {
        const agent = index === 0 ? 'claude' : 'codex';
        return (
          <div key={agent}>
            {query.isLoading && (
              <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
                正在读取 {agent} 会话…
              </p>
            )}
            {query.isError && (
              <p role="alert" className="px-3 py-2 text-xs text-destructive-foreground">
                {agent} 会话：{query.error.message}{' '}
                <button
                  type="button"
                  className="underline"
                  disabled={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  重新读取
                </button>
              </p>
            )}
            <SessionSource agent={agent} workspaceId={workspace.id} sessions={query.data ?? []} choose={choose} />
          </div>
        );
      })}
    </>
  );
}
export default function CommandPalette({
  workspaces,
  workspace,
  actions,
  close,
}: {
  workspaces: Workspace[];
  workspace?: Workspace;
  actions: PaletteActions;
  close(): void;
}) {
  const [error, setError] = useState<string>();
  const run = (action: Action) => {
    if (action.workspace && (!workspace || useChat.getState().workspaceId !== workspace.id)) {
      setError('工作区已改变，请重新打开命令面板。');
      return;
    }
    if (!action.run()) {
      setError('当前操作暂不可用，请重新打开对应面板。');
      return;
    }
    close();
  };
  const choose = (session: SessionSummary) =>
    run({
      id: session.sessionId,
      label: session.summary,
      workspace: true,
      run: () => {
        void useChat.getState().openSession(session);
        return true;
      },
    });
  return (
    <DetailDialog title="网页命令面板" onClose={close}>
      <Command label="工作区、会话和常用操作" loop>
        <Command.Input
          autoFocus
          placeholder="搜索工作区、会话或操作…"
          aria-label="搜索命令"
          className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive-foreground">
            {error}
          </p>
        )}
        <Command.List className="mt-3 max-h-[50vh] overflow-y-auto">
          <Command.Empty className="px-3 py-6 text-sm text-muted-foreground">没有匹配结果。</Command.Empty>
          <Command.Group heading="工作区">
            {workspaces.map((target) => (
              <Command.Item
                key={target.id}
                value={`workspace:${target.id}`}
                keywords={[target.name]}
                className={itemClass}
                onSelect={() => {
                  if (!workspaces.some((item) => item.id === target.id)) {
                    setError('工作区已移除。');
                    return;
                  }
                  useChat.getState().selectWorkspace(target.id);
                  close();
                }}
              >
                {target.name}
                <span className="text-xs text-muted-foreground">切换工作区</span>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="常用操作">
            {commonActions(actions, workspace?.id ?? '').map((action) => (
              <Command.Item
                key={action.id}
                value={`action:${action.id}`}
                keywords={[action.label]}
                className={itemClass}
                disabled={action.workspace && !workspace}
                onSelect={() => run(action)}
              >
                {action.label}
              </Command.Item>
            ))}
          </Command.Group>
          <PaletteSessions workspace={workspace} choose={choose} />
        </Command.List>
      </Command>
    </DetailDialog>
  );
}
