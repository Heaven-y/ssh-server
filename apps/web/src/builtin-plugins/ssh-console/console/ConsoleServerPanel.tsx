import { sshApi, sshKeys } from '../ssh/api';
import { lazy, Suspense, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ManagedServer } from '@agentdeck/shared/ssh';

import { buttonClass } from '../../../ui/styles';
import { DetailDialog } from '../../../ui/DetailDialog';
import { ServerConnectionForm } from '../ssh/ServerConnectionForm';
import { ConsoleViewTabs } from './ConsoleTabs';
import { ConsoleResources } from './ConsoleResources';
import { ConsoleFiles } from './ConsoleFiles';
import type { ConsoleServerTab, ConsoleView } from './console-state';

const ConsoleTerminals = lazy(() => import('./ConsoleTerminals'));
export function ConsoleServerPanel({
  tab,
  server,
  active,
  shown,
  manage,
}: {
  tab: ConsoleServerTab;
  server?: ManagedServer;
  active: boolean;
  shown: boolean;
  manage(): void;
}) {
  const id = useId();
  const [view, setView] = useState<ConsoleView>('overview');
  const [terminalLoaded, setTerminalLoaded] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const credentials = useQuery({
    queryKey: sshKeys.sshCredentials(tab.serverId),
    queryFn: ({ signal }) => sshApi.sshCredentials(tab.serverId, signal),
    enabled: active,
    refetchInterval: active ? 10000 : false,
    retry: false,
  });
  const connected = credentials.data?.connected === true;
  const enabled = active && connected;
  const select = (next: ConsoleView) => {
    setView(next);
    if (next === 'terminals') setTerminalLoaded(true);
    if (next === 'files') setFilesLoaded(true);
  };
  return (
    <section
      id={`console-server-${encodeURIComponent(tab.serverId)}`}
      hidden={!shown}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ConnectionHeader
        serverId={tab.serverId}
        server={server}
        connected={connected}
        open={() => (server ? setConnectOpen(true) : manage())}
      />
      <ConsoleViewTabs prefix={id} view={view} select={select} />
      {!connected && (
        <p role="status" className="px-5 py-3 text-sm text-muted-foreground">
          {credentials.isError
            ? '连接状态读取失败，请打开连接详情后重试。'
            : '连接服务器后显示数据。切换页面保留已打开的终端。'}
        </p>
      )}
      <ConsoleServerContent
        id={id}
        tab={tab}
        view={view}
        enabled={enabled}
        terminalLoaded={terminalLoaded}
        filesLoaded={filesLoaded}
      />
      {active && connectOpen && server && (
        <DetailDialog title={`连接 ${server.name}`} onClose={() => setConnectOpen(false)}>
          <ServerConnectionForm server={server} />
        </DetailDialog>
      )}
    </section>
  );
}

function ConnectionHeader({
  serverId,
  server,
  connected,
  open,
}: {
  serverId: string;
  server?: ManagedServer;
  connected: boolean;
  open(): void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-5 py-2">
      <div className="mr-auto min-w-0">
        <p className="text-sm font-medium">{server?.name ?? serverId}</p>
        <p className="break-all text-xs text-muted-foreground">
          {serverId} · {connected ? '已连接' : '未连接'}
        </p>
      </div>
      <button type="button" className={buttonClass('outline')} onClick={open}>
        {connected ? '连接详情' : '连接服务器'}
      </button>
    </div>
  );
}
function ConsoleServerContent({
  id,
  tab,
  view,
  enabled,
  terminalLoaded,
  filesLoaded,
}: {
  id: string;
  tab: ConsoleServerTab;
  view: ConsoleView;
  enabled: boolean;
  terminalLoaded: boolean;
  filesLoaded: boolean;
}) {
  return (
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${view}`} className="flex min-h-0 flex-1 flex-col">
      {(view === 'overview' || view === 'processes') && (
        <ConsoleResources serverId={tab.serverId} directory={tab.directory} view={view} active={enabled} />
      )}
      {filesLoaded && (
        <div hidden={view !== 'files'} className="flex min-h-0 flex-1 flex-col">
          <ConsoleFiles serverId={tab.serverId} initialDirectory={tab.directory} active={enabled && view === 'files'} />
        </div>
      )}
      {terminalLoaded && (
        <div hidden={view !== 'terminals'} className="flex min-h-0 flex-1 flex-col">
          <Suspense
            fallback={
              <p role="status" className="p-5 text-sm">
                正在打开终端…
              </p>
            }
          >
            <ConsoleTerminals
              serverId={tab.serverId}
              directory={tab.directory}
              visible={enabled && view === 'terminals'}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
