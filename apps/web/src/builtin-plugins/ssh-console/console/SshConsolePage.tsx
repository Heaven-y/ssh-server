import { sshApi, sshKeys } from '../ssh/api';
import { useQuery } from '@tanstack/react-query';
import { useState, type Ref } from 'react';
import { Plus, Server, Settings2 } from 'lucide-react';

import { buttonClass } from '../../../ui/styles';
import { ConsoleServerPicker } from './ConsoleServerPicker';
import { ConsoleServerTabs } from './ConsoleTabs';
import { ConsoleServerPanel } from './ConsoleServerPanel';
import { consoleError, useConsoleVisible, type ConsoleServerTab } from './console-state';

export type SshConsolePageProps = {
  visible: boolean;
  onManageServers(): void;
  onLegacyTools?(): void;
  legacyToolsRef?: Ref<HTMLButtonElement>;
  legacyToolsOpen?: boolean;
  initialServer?: string;
  initialDirectory?: string;
};
function useConsoleNavigation(initialServer?: string, initialDirectory = '~') {
  const initial = initialServer ? [{ serverId: initialServer, directory: initialDirectory }] : [];
  const [tabs, setTabs] = useState<ConsoleServerTab[]>(initial);
  const [selected, setSelected] = useState(initialServer);
  const open = (alias: string) => {
    setTabs((current) =>
      current.some((item) => item.serverId === alias) ? current : [...current, { serverId: alias, directory: '~' }],
    );
    setSelected(alias);
  };
  const close = (alias: string) => {
    const next = tabs.filter((item) => item.serverId !== alias);
    setTabs(next);
    if (selected === alias) setSelected(next[0]?.serverId);
  };
  return { tabs, selected, setSelected, open, close };
}

export default function SshConsolePage({
  visible,
  onManageServers,
  onLegacyTools,
  legacyToolsRef,
  legacyToolsOpen = false,
  initialServer,
  initialDirectory,
}: SshConsolePageProps) {
  const active = useConsoleVisible(visible);
  const navigation = useConsoleNavigation(initialServer, initialDirectory);
  const [picker, setPicker] = useState(false);
  const servers = useQuery({
    queryKey: sshKeys.sshHosts,
    queryFn: ({ signal }) => sshApi.listSshHosts(signal),
    enabled: active,
    staleTime: 10000,
    retry: false,
  });
  return (
    <section aria-label="SSH Console" hidden={!visible} className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div
        role="group"
        aria-label="控制台工具"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2"
      >
        <button type="button" className={buttonClass('outline')} onClick={() => setPicker(true)}>
          <Plus aria-hidden className="size-4" />
          连接其他服务器
        </button>
        <button type="button" className={buttonClass('ghost')} onClick={onManageServers}>
          <Settings2 aria-hidden className="size-4" />
          服务器档案
        </button>
        {onLegacyTools && (
          <button
            ref={legacyToolsRef}
            type="button"
            aria-controls="legacy-server-tools"
            aria-expanded={legacyToolsOpen}
            className={`${buttonClass('ghost')} ml-auto`}
            onClick={onLegacyTools}
          >
            项目服务器工具
          </button>
        )}
      </div>
      {servers.error && (
        <p role="alert" className="px-5 py-3 text-sm text-destructive-foreground">
          {consoleError(servers.error)}
        </p>
      )}
      <ConsoleServerTabs
        tabs={navigation.tabs}
        servers={servers.data ?? []}
        selected={navigation.selected}
        select={navigation.setSelected}
        close={navigation.close}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {navigation.tabs.map((tab) => (
          <ConsoleServerPanel
            key={tab.serverId}
            tab={tab}
            server={servers.data?.find((item) => item.alias === tab.serverId)}
            active={active && navigation.selected === tab.serverId}
            shown={navigation.selected === tab.serverId}
            manage={onManageServers}
          />
        ))}
        {!navigation.tabs.length && (
          <div className="m-auto max-w-md space-y-3 p-6 text-center">
            <Server aria-hidden className="mx-auto size-8 text-muted-foreground" />
            <p className="font-medium">选择服务器开始</p>
            <p className="text-sm leading-6 text-muted-foreground">
              服务器独立于本地项目。连接后可查看资源、进程、只读文件并打开终端。
            </p>
            <button type="button" className={buttonClass('primary')} onClick={() => setPicker(true)}>
              打开服务器
            </button>
          </div>
        )}
      </div>
      {visible && picker && (
        <ConsoleServerPicker
          servers={servers.data ?? []}
          close={() => setPicker(false)}
          select={(alias) => {
            navigation.open(alias);
            setPicker(false);
          }}
          manage={() => {
            setPicker(false);
            onManageServers();
          }}
        />
      )}
    </section>
  );
}
