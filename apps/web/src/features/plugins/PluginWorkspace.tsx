import { lazy, Suspense, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { WorkbenchPlugin, Workspace } from '@agentdeck/shared';
import { buttonClass } from '../../ui/styles';
import { PluginErrorBoundary } from './PluginErrorBoundary';

const PluginFrame = lazy(() => import('./PluginFrame'));
const SshConsolePage = lazy(() => import('../ssh-console/SshConsolePage'));

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
      className="flex h-full min-h-0 flex-col"
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

export function PluginWorkspace({
  plugin,
  sshPlugin,
  project,
  close,
  manageServers,
  command,
}: {
  plugin?: WorkbenchPlugin;
  sshPlugin?: WorkbenchPlugin;
  project?: Workspace;
  close(): void;
  manageServers(): void;
  command?: { id: string; sequence: number };
}) {
  const sshVisible = plugin?.manifest.id === 'ssh-console';
  const [sshVisited, setSshVisited] = useState(false);
  if (sshVisible && !sshVisited) setSshVisited(true);
  return (
    <>
      {sshPlugin && sshVisited && (
        <PluginPage plugin={sshPlugin} visible={sshVisible} close={close}>
          <SshConsolePage
            visible={sshVisible}
            onManageServers={manageServers}
            initialServer={project?.server}
            initialDirectory={project?.remoteDir}
          />
        </PluginPage>
      )}
      {plugin && !plugin.builtin && (
        <PluginPage key={plugin.manifest.id} plugin={plugin} visible close={close}>
          <PluginFrame plugin={plugin} project={project} command={command} />
        </PluginPage>
      )}
    </>
  );
}
