import { Tab, TabList, TabProvider } from '@ariakit/react';
import { Activity, FolderOpen, ListTree, TerminalSquare, X } from 'lucide-react';
import type { ManagedServer } from '@agentdeck/shared';
import { buttonClass } from '../../ui/styles';
import type { ConsoleServerTab, ConsoleView } from './console-state';

export const consoleViews = [
  { id: 'overview', label: '概览', Icon: Activity },
  { id: 'processes', label: '进程', Icon: ListTree },
  { id: 'files', label: '文件', Icon: FolderOpen },
  { id: 'terminals', label: '终端', Icon: TerminalSquare },
] as const;

export function ConsoleServerTabs({
  tabs,
  servers,
  selected,
  select,
  close,
}: {
  tabs: ConsoleServerTab[];
  servers: ManagedServer[];
  selected?: string;
  select(id: string): void;
  close(id: string): void;
}) {
  return (
    <TabProvider
      selectedId={selected}
      setSelectedId={(id) => {
        if (id) select(id);
      }}
    >
      <TabList aria-label="服务器标签" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4">
        {tabs.map((tab) => {
          const server = servers.find((item) => item.alias === tab.serverId);
          return (
            <div key={tab.serverId} className="flex shrink-0 items-center">
              <Tab
                id={tab.serverId}
                aria-controls={`console-server-${encodeURIComponent(tab.serverId)}`}
                className="min-h-11 rounded-t-lg px-4 text-sm text-muted-foreground aria-selected:bg-muted aria-selected:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
              >
                {server?.name ?? tab.serverId}
              </Tab>
              <button
                type="button"
                className={buttonClass('ghost')}
                aria-label={`关闭服务器标签 ${server?.name ?? tab.serverId}`}
                title="关闭标签，保留服务器上的终端"
                onClick={() => close(tab.serverId)}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
          );
        })}
      </TabList>
    </TabProvider>
  );
}

export function ConsoleViewTabs({
  view,
  prefix,
  select,
}: {
  view: ConsoleView;
  prefix: string;
  select(view: ConsoleView): void;
}) {
  return (
    <TabProvider
      selectedId={`${prefix}-${view}`}
      setSelectedId={(id) => {
        const selected = consoleViews.find((item) => `${prefix}-${item.id}` === id);
        if (selected) select(selected.id);
      }}
    >
      <TabList aria-label="SSH 控制台视图" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4">
        {consoleViews.map(({ id, label, Icon }) => (
          <Tab
            key={id}
            id={`${prefix}-${id}`}
            aria-controls={`${prefix}-panel`}
            className="flex min-h-11 items-center gap-2 border-b-2 border-transparent px-4 text-sm text-muted-foreground aria-selected:border-accent aria-selected:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </Tab>
        ))}
      </TabList>
    </TabProvider>
  );
}
