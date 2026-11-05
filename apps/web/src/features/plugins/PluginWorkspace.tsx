import { lazy, Suspense, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { WorkbenchPlugin, Workspace } from '@agentdeck/shared';
import { buttonClass } from '../../ui/styles';
import { PluginErrorBoundary } from './PluginErrorBoundary';

const PluginFrame = lazy(() => import('./PluginFrame'));
const SshConsolePage = lazy(() => import('../ssh-console/SshConsolePage'));
const LegacyServerTools = lazy(() =>
  import('../ssh-console/LegacyServerTools').then((module) => ({ default: module.LegacyServerTools })),
);

function PluginPage({
  plugin,
  visible,
  close,
  children,
}: {
  plugin: WorkbenchPlugin;
  visible: boolean;
  close(): void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={`${plugin.manifest.name}页面`}
      hidden={!visible}
      inert={!visible}
      className={visible ? 'flex h-full min-h-0 flex-col' : 'hidden'}
    >
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <h1 className="text-sm font-semibold">{plugin.manifest.name}</h1>
        <button
          type="button"
          aria-label={`关闭${plugin.manifest.name}页面`}
          className={buttonClass('ghost')}
          onClick={close}
        >
          <X aria-hidden className="size-4" />
          返回对话
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <PluginErrorBoundary close={close}>
          <Suspense
            fallback={
              <p role="status" className="p-4 text-sm">
                正在打开插件页面…
              </p>
            }
          >
            {children}
          </Suspense>
        </PluginErrorBoundary>
      </div>
    </section>
  );
}

function SshPluginPage({
  plugin,
  visible,
  project,
  close,
  manageServers,
  bindServer,
}: {
  plugin: WorkbenchPlugin;
  visible: boolean;
  project?: Workspace;
  close(): void;
  manageServers(): void;
  bindServer?(): void;
}) {
  const [legacy, setLegacy] = useState(false);
  const [legacyVisited, setLegacyVisited] = useState(false);
  const legacyTrigger = useRef<HTMLButtonElement>(null);
  const previousLegacy = useRef(false);
  useLayoutEffect(() => {
    const closedLegacy = previousLegacy.current && !legacy;
    previousLegacy.current = legacy;
    // 只在控制台内返回时恢复入口；切去其他页面不抢走导航焦点。
    if (closedLegacy && visible) legacyTrigger.current?.focus();
  }, [legacy, visible]);
  return (
    <PluginPage plugin={plugin} visible={visible} close={close}>
      <div hidden={legacy} inert={legacy} className={legacy ? 'hidden' : 'h-full min-h-0'}>
        <SshConsolePage
          visible={visible && !legacy}
          onManageServers={manageServers}
          legacyToolsRef={legacyTrigger}
          legacyToolsOpen={legacy}
          onLegacyTools={() => {
            setLegacy(true);
            setLegacyVisited(true);
          }}
          initialServer={project?.server}
          initialDirectory={project?.remoteDir}
        />
      </div>
      {legacyVisited && (
        <LegacyServerTools
          workspace={project}
          visible={visible && legacy}
          close={() => setLegacy(false)}
          bind={() => bindServer?.()}
        />
      )}
    </PluginPage>
  );
}

export function PluginWorkspace({
  plugin,
  sshPlugin,
  project,
  close,
  manageServers,
  bindServer,
  command,
}: {
  plugin?: WorkbenchPlugin;
  sshPlugin?: WorkbenchPlugin;
  project?: Workspace;
  close(): void;
  manageServers(): void;
  bindServer?(): void;
  command?: { id: string; sequence: number };
}) {
  const sshVisible = plugin?.manifest.id === 'ssh-console';
  const [sshVisited, setSshVisited] = useState(false);
  if (sshVisible && !sshVisited) setSshVisited(true);
  return (
    <>
      {sshPlugin && sshVisited && (
        <SshPluginPage
          plugin={sshPlugin}
          visible={sshVisible}
          project={project}
          close={close}
          manageServers={manageServers}
          bindServer={bindServer}
        />
      )}
      {plugin && !plugin.builtin && (
        <PluginPage key={plugin.manifest.id} plugin={plugin} visible close={close}>
          <PluginFrame plugin={plugin} project={project} command={command} />
        </PluginPage>
      )}
    </>
  );
}
