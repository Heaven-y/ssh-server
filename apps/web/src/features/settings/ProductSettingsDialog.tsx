import { useEffect, useId, useRef, useState } from 'react';
import { MonitorCheck, Settings2, SlidersHorizontal, X } from 'lucide-react';
import type { AgentKind } from '@agentdeck/shared/conversation';
import { AgentIcon } from '../../ui/BrandIcons';
import { buttonClass } from '../../ui/styles';
import { EnvironmentReport } from './EnvironmentReport';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';
import { ModelSettingsPanel } from './ModelSettingsPanel';
import { nativeAgentNames } from './native-resource-labels';
import type { SettingsLeave } from './use-model-settings';

export type SettingsPage = AgentKind | 'general' | 'environment';
const agentPages: AgentKind[] = ['claude', 'codex', 'antigravity'];
const navigationClass = (selected: boolean) =>
  `flex w-full shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors ${selected ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`;

function SettingsNavigation({ page, select }: { page: SettingsPage; select(page: SettingsPage): void }) {
  return (
    <nav
      aria-label="设置分类"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-background/40 p-3 sm:w-44 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-4"
    >
      <p className="mb-2 hidden px-3 text-[11px] text-muted-foreground sm:block">模型配置</p>
      {agentPages.map((agent) => (
        <button
          key={agent}
          type="button"
          aria-current={page === agent ? 'page' : undefined}
          className={navigationClass(page === agent)}
          onClick={() => select(agent)}
        >
          <AgentIcon agent={agent} className="size-4" />
          <span className="whitespace-nowrap">{nativeAgentNames[agent]}</span>
        </button>
      ))}
      <p className="mb-2 mt-6 hidden px-3 text-[11px] text-muted-foreground sm:block">工作台</p>
      <button
        type="button"
        aria-current={page === 'general' ? 'page' : undefined}
        className={navigationClass(page === 'general')}
        onClick={() => select('general')}
      >
        <SlidersHorizontal aria-hidden className="size-4 shrink-0" />
        <span className="whitespace-nowrap">通用设置</span>
      </button>
      <button
        type="button"
        aria-current={page === 'environment' ? 'page' : undefined}
        className={navigationClass(page === 'environment')}
        onClick={() => select('environment')}
      >
        <MonitorCheck aria-hidden className="size-4 shrink-0" />
        <span className="whitespace-nowrap">运行环境</span>
      </button>
    </nav>
  );
}

/** 常用设置保持同一个侧栏；敏感表单离开分类即卸载。 */
export default function ProductSettingsDialog({
  onClose,
  onNative,
  onLaunchEnvironment,
  page: controlledPage,
  onPageChange,
  initialPage = 'claude',
  projectId,
}: {
  onClose(): void;
  onNative(agent: AgentKind): void;
  onLaunchEnvironment?(agent: AgentKind): void;
  page?: SettingsPage;
  onPageChange?(page: SettingsPage): void;
  initialPage?: SettingsPage;
  projectId?: string;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const guardRef = useRef<SettingsLeave>((action) => action());
  const [localPage, setLocalPage] = useState<SettingsPage>(initialPage);
  const page = controlledPage ?? localPage;
  const modelPage = page !== 'general' && page !== 'environment';
  const select = (next: SettingsPage) => {
    if (next === page) return;
    guardRef.current(() => {
      setLocalPage(next);
      onPageChange?.(next);
    });
  };
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        guardRef.current(onClose);
      }}
      className="m-auto h-[min(720px,calc(100dvh-40px))] max-h-[calc(100dvh-40px)] w-[min(1000px,calc(100vw-32px))] max-w-none overflow-hidden rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h2 id={id} className="flex items-center gap-2 text-sm font-semibold">
            <Settings2 aria-hidden className="size-4" />
            设置
          </h2>
          <button
            type="button"
            className={buttonClass('ghost')}
            aria-label="关闭设置"
            onClick={() => guardRef.current(onClose)}
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <SettingsNavigation page={page} select={select} />
          <main className={`min-h-0 min-w-0 flex-1 p-5 sm:p-6 ${modelPage ? 'overflow-hidden' : 'overflow-y-auto'}`}>
            {page === 'general' ? (
              <GeneralSettingsPanel guardRef={guardRef} />
            ) : page === 'environment' ? (
              <EnvironmentReport disabled={false} />
            ) : (
              <ModelSettingsPanel
                key={page}
                agent={page}
                projectId={projectId}
                guardRef={guardRef}
                onNative={() => onNative(page)}
                onLaunchEnvironment={onLaunchEnvironment ? () => onLaunchEnvironment(page) : undefined}
              />
            )}
          </main>
        </div>
      </div>
    </dialog>
  );
}
