import { lazy, Suspense, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AgentKind, NativeResourceCatalog as Catalog, Workspace } from '@agentdeck/shared';
import { api } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { SettingsDetailDialog } from './SettingsDetailDialog';
import { NativeResourceCatalog, type NativeResourceSelection } from './NativeResourceCatalog';
import { nativeAgentNames, nativeSettingsError } from './native-resource-labels';

const NativeResourceEditor = lazy(() => import('./NativeResourceEditor'));
const NativeResourceCreate = lazy(() => import('./NativeResourceCreate'));

export default function NativeResourcesDialog({
  agent,
  project,
  onClose,
  onBack,
}: {
  agent: AgentKind;
  project?: Workspace;
  onClose(): void;
  onBack(): void;
}) {
  const projectId = project?.id;
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [target, setTarget] = useState<NativeResourceSelection>();
  useEffect(() => {
    const controller = new AbortController();
    void api
      .listNativeResources({ agent, projectId }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCatalog(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(nativeSettingsError(reason));
      });
    return () => controller.abort();
  }, [agent, projectId, reload]);
  const refresh = () => {
    setCatalog(undefined);
    setError('');
    setReload((value) => value + 1);
  };
  const returnToCatalog = () => {
    setTarget(undefined);
    refresh();
  };
  if (target)
    return (
      <Suspense fallback={<p role="status">正在打开文件编辑器…</p>}>
        {'resource' in target ? (
          <NativeResourceEditor
            context={{ agent, projectId }}
            resource={target.resource}
            onBack={returnToCatalog}
            onClose={onClose}
          />
        ) : (
          <NativeResourceCreate
            context={{ agent, projectId }}
            root={target.root}
            onBack={returnToCatalog}
            onClose={onClose}
          />
        )}
      </Suspense>
    );
  return (
    <SettingsDetailDialog title={`原生配置与扩展 · ${nativeAgentNames[agent]}`} onBack={onBack} onClose={onClose}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1 text-sm text-muted-foreground">
          <p>{project ? `当前项目：${project.name}` : '尚未选择项目，显示当前可用的原生入口。'}</p>
          {project && <p className="break-all font-mono text-xs">{project.dir}</p>}
        </div>
        <button type="button" className={buttonClass('outline')} onClick={refresh} disabled={!catalog && !error}>
          <RefreshCw aria-hidden className="size-4" />
          刷新目录
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {catalog ? (
        <NativeResourceCatalog catalog={catalog} select={setTarget} />
      ) : (
        !error && (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            正在读取原生资源目录…
          </p>
        )
      )}
    </SettingsDetailDialog>
  );
}
