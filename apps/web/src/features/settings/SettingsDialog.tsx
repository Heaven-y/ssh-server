import { lazy, Suspense, useState } from 'react';
import ProductSettingsDialog from './ProductSettingsDialog';
import type { AgentKind, Workspace } from '@agentdeck/shared';

const NativeResourcesDialog = lazy(() => import('./NativeResourcesDialog'));
const LaunchEnvironmentPanel = lazy(() => import('./LaunchEnvironmentPanel'));
/** 同时只挂载一个对话框；离开原生视图立即清理其敏感内容。 */
export default function SettingsDialog({ onClose, project }: { onClose(): void; project?: Workspace }) {
  const [native, setNative] = useState<AgentKind | null>(null);
  const [launch, setLaunch] = useState<AgentKind | null>(null);
  if (!native && !launch)
    return <ProductSettingsDialog onClose={onClose} onNative={setNative} onLaunchEnvironment={setLaunch} />;
  return (
    <Suspense
      fallback={
        <p role="status" className="absolute right-4 top-14 z-50 rounded border border-border bg-card p-3 text-sm">
          正在打开原生配置…
        </p>
      }
    >
      {native ? (
        <NativeResourcesDialog agent={native} project={project} onClose={onClose} onBack={() => setNative(null)} />
      ) : (
        launch && <LaunchEnvironmentPanel agent={launch} onClose={onClose} onBack={() => setLaunch(null)} />
      )}
    </Suspense>
  );
}
