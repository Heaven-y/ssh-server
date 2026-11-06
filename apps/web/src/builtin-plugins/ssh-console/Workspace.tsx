import { lazy, useLayoutEffect, useRef, useState } from 'react';
import type { BuiltinPluginPageProps } from '../../features/plugins/builtin-contracts';
import { ServerManagerDialog } from './ssh/ServerManagerDialog';
import { BindServerDialog } from './legacy/BindServerDialog';
const SshConsolePage = lazy(() => import('./console/SshConsolePage'));
const LegacyServerTools = lazy(() =>
  import('./legacy/LegacyServerTools').then((module) => ({ default: module.LegacyServerTools })),
);
export default function SshConsoleWorkspace({ visible, project }: BuiltinPluginPageProps) {
  const [serversOpen, setServersOpen] = useState(false);
  const [bindingOpen, setBindingOpen] = useState(false);
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
    <>
      {serversOpen && <ServerManagerDialog onClose={() => setServersOpen(false)} />}
      {bindingOpen && project && <BindServerDialog project={project} onClose={() => setBindingOpen(false)} />}
      <div hidden={legacy} inert={legacy} className={legacy ? 'hidden' : 'h-full min-h-0'}>
        <SshConsolePage
          visible={visible && !legacy}
          onManageServers={() => setServersOpen(true)}
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
          bind={() => setBindingOpen(true)}
        />
      )}
    </>
  );
}
