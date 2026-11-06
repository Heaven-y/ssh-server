import { builtinPlugins } from '../../builtin-plugins/registry';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { WorkbenchPlugin } from '@agentdeck/shared/plugins';
import type { Workspace } from '@agentdeck/shared/projects';
import { buttonClass } from '../../ui/styles';
import { PluginErrorBoundary } from './PluginErrorBoundary';

const PluginFrame = lazy(() => import('./PluginFrame'));
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

export function PluginWorkspace({
  plugin,
  builtinPlugins: enabled,
  project,
  close,
  command,
}: {
  plugin?: WorkbenchPlugin;
  builtinPlugins: WorkbenchPlugin[];
  project?: Workspace;
  close(): void;
  command?: { id: string; sequence: number };
}) {
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  const activeId = plugin?.builtin ? plugin.manifest.id : undefined;
  if (activeId && !visited.has(activeId)) setVisited(new Set(visited).add(activeId));
  return (
    <>
      {enabled
        .filter((entry) => visited.has(entry.manifest.id))
        .map((entry) => {
          const registration = builtinPlugins[entry.manifest.id];
          if (!registration) return null;
          const visible = activeId === entry.manifest.id;
          const Page = registration.Page;
          return (
            <PluginPage key={entry.manifest.id} plugin={entry} visible={visible} close={close}>
              <Page visible={visible} project={project} close={close} command={visible ? command : undefined} />
            </PluginPage>
          );
        })}
      {plugin && !plugin.builtin && (
        <PluginPage key={plugin.manifest.id} plugin={plugin} visible close={close}>
          <PluginFrame plugin={plugin} project={project} command={command} />
        </PluginPage>
      )}
    </>
  );
}
