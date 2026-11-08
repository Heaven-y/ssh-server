import { Tab, TabList, TabProvider } from '@ariakit/react';
import { CircleDot, LoaderCircle, ShieldQuestion, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Workspace } from '@agentdeck/shared/projects';
import type { ConversationView } from './chat-state';
import { useChat } from './chat-store';
import { conversationById, conversationBusy, conversationTitle, waitingPermission } from './conversations';
import { AgentIcon } from '../../ui/BrandIcons';

function TabStatus({ view }: { view: ConversationView }) {
  if (waitingPermission(view)) return <ShieldQuestion aria-label="等待批准" className="size-3.5 text-warning" />;
  if (conversationBusy(view)) return <LoaderCircle aria-label="运行中" className="size-3.5 motion-safe:animate-spin" />;
  return view.unread ? <CircleDot aria-label="未读" className="size-3 text-interactive" /> : null;
}

function ConversationTab({ view, project, active }: { view: ConversationView; project?: Workspace; active: boolean }) {
  const close = useChat((state) => state.closeConversationTab);
  const move = useChat((state) => state.moveConversationTab);
  const title = conversationTitle(view);
  const closeTab = () => {
    close(view.conversationId);
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="已打开的会话"] [aria-selected="true"]')?.focus(),
    );
  };
  return (
    <div
      role="presentation"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-agentdeck-tab', view.conversationId);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-agentdeck-tab')) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        move(event.dataTransfer.getData('application/x-agentdeck-tab'), view.conversationId);
      }}
      data-active={active || undefined}
      className="conversation-tab group flex min-w-28 max-w-64 shrink-0 items-center border-r border-border"
    >
      <Tab
        id={`tab-${view.conversationId}`}
        aria-controls="conversation-panel"
        title={`${project?.name ?? ''} · ${title}`}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-interactive"
        onAuxClick={(event) => {
          if (event.button === 1) closeTab();
        }}
      >
        <AgentIcon agent={view.agent} className="size-3.5" />
        <span className="truncate">{title}</span>
        <TabStatus view={view} />
      </Tab>
      <button
        type="button"
        aria-label={`关闭标签“${title}”`}
        title="关闭标签"
        className="mr-1 flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-interactive"
        onClick={closeTab}
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

export function ConversationTabs({
  projects,
  visible = true,
  onOpen,
}: {
  projects: Workspace[];
  visible?: boolean;
  onOpen?(id: string): void;
}) {
  const active = useChat((state) => state.conversationId);
  const open = useChat((state) => state.openConversation);
  const tabs = useChat(
    useShallow((state) => state.tabIds.map((id) => conversationById(state, id)).filter((view) => !!view)),
  );
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bar.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  if (!tabs.length) return null;
  return (
    <TabProvider
      selectedId={visible ? `tab-${active}` : null}
      setSelectedId={(id) => {
        if (id) (onOpen ?? open)(id.slice(4));
      }}
    >
      <TabList
        ref={bar}
        aria-label="已打开的会话"
        className="conversation-tabs flex shrink-0 overflow-x-auto border-b border-border bg-sidebar"
      >
        {tabs.map((view) => (
          <ConversationTab
            key={view.conversationId}
            view={view}
            active={visible && view.conversationId === active}
            project={projects.find((entry) => entry.id === view.workspaceId)}
          />
        ))}
      </TabList>
    </TabProvider>
  );
}
