import { useLayoutEffect, useRef, useState } from 'react';
import type { Workspace } from '@agentdeck/shared/projects';
import { ServerDock, type ServerDockView } from './ServerDock';
import { buttonClass } from '../../../ui/styles';

/** 旧项目绑定工具只在控制台内显式打开；保留已有任务与终端，避免占据对话侧栏。 */
export function LegacyServerTools({
  workspace,
  visible,
  close,
  bind,
}: {
  workspace?: Workspace;
  visible: boolean;
  close(): void;
  bind(): void;
}) {
  const [view, setView] = useState<ServerDockView>('resources');
  const [loaded, setLoaded] = useState<ReadonlySet<ServerDockView>>(() => new Set(['resources']));
  const back = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (visible) back.current?.focus();
  }, [visible]);
  return (
    <section
      id="legacy-server-tools"
      hidden={!visible}
      inert={!visible}
      className={visible ? 'flex h-full min-h-0 flex-col' : 'hidden'}
      aria-label="项目服务器工具"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <div className="mr-auto">
          <h2 className="text-sm font-medium">项目服务器工具</h2>
          <p className="text-xs text-muted-foreground">{workspace?.name ?? '先选择工作区'} · Slurm、文件操作与旧终端</p>
        </div>
        <button type="button" disabled={!workspace} className={buttonClass('ghost')} onClick={bind}>
          设置项目服务器
        </button>
        <button ref={back} type="button" className={buttonClass('outline')} onClick={close}>
          返回 SSH Console
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <ServerDock
          workspace={workspace}
          open={visible}
          view={view}
          loaded={loaded}
          onSelectView={(next) => {
            setView(next);
            setLoaded((current) => (current.has(next) ? current : new Set(current).add(next)));
          }}
          onHide={close}
        />
      </div>
    </section>
  );
}
