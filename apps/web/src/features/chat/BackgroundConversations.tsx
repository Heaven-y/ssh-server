import { CircleDot, LoaderCircle, MessageSquare, ShieldQuestion, Square } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Workspace } from '@agentdeck/shared/projects';
import { AgentIcon } from '../../ui/BrandIcons';
import type { ConversationView } from './chat-state';
import { useChat } from './chat-store';
import {
  conversationBusy,
  conversationHasDraft,
  conversationTitle,
  conversationViews,
  waitingPermission,
} from './conversations';

function status(view: ConversationView) {
  if (view.interruptRequested) return { text: '正在停止', Icon: LoaderCircle };
  if (waitingPermission(view)) return { text: '等待批准', Icon: ShieldQuestion };
  if (conversationBusy(view)) return { text: '运行中', Icon: LoaderCircle };
  if (view.unread) return { text: '有新消息', Icon: CircleDot };
  return { text: '草稿', Icon: MessageSquare };
}

/** 原生 ID 尚未返回的任务也能找回；插件遮住当前会话时仍保留入口。 */
export function BackgroundConversations({
  projects,
  collapsed,
  open,
}: {
  projects: Workspace[];
  collapsed: boolean;
  open?: (id: string) => void;
}) {
  const views = useChat(
    useShallow((state) =>
      conversationViews(state).filter(
        (view) =>
          (view.conversationId !== state.conversationId || !state.conversationVisible) &&
          (conversationBusy(view) || view.unread || !!view.draft || (!view.sessionId && conversationHasDraft(view))),
      ),
    ),
  );
  const stop = useChat((state) => state.interruptConversation);
  const select = useChat((state) => state.openConversation);
  if (!views.length) return null;
  return (
    <section aria-label="后台会话" className="mt-2 max-h-52 shrink-0 overflow-y-auto border-b border-border pb-2">
      {!collapsed && <p className="px-3 pb-1 text-[11px] text-muted-foreground">后台会话</p>}
      <ul className="space-y-0.5">
        {views.map((view) => {
          const title = conversationTitle(view);
          const project = projects.find((entry) => entry.id === view.workspaceId)?.name ?? '';
          const { text, Icon } = status(view);
          return (
            <li key={view.conversationId} className="flex min-w-0 items-center gap-1 rounded-lg hover:bg-muted/70">
              <button
                type="button"
                aria-label={`返回${title}（${text}）`}
                title={`${project} · ${title} · ${text}`}
                className={`flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-accent ${collapsed ? 'justify-center' : ''}`}
                onClick={() => (open ?? select)(view.conversationId)}
              >
                {collapsed ? (
                  <Icon aria-hidden className="size-4 shrink-0 text-accent" />
                ) : (
                  <>
                    <AgentIcon agent={view.agent} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 py-1">
                      <span className="block truncate">{title}</span>
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Icon
                          aria-hidden
                          className={`size-3 shrink-0 ${conversationBusy(view) && !waitingPermission(view) ? 'motion-safe:animate-spin' : ''}`}
                        />
                        <span className="truncate">
                          {project} · {text}
                        </span>
                      </span>
                    </span>
                  </>
                )}
              </button>
              {!collapsed && conversationBusy(view) && (
                <button
                  type="button"
                  aria-label={`停止${title}`}
                  title="停止"
                  disabled={view.interruptRequested}
                  className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  onClick={() => stop(view.conversationId)}
                >
                  <Square aria-hidden className="size-3" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
