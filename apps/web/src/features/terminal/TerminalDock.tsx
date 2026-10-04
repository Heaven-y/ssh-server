import { useEffect, useState } from 'react';
import { Tab, TabList, TabProvider } from '@ariakit/react';
import { Columns2, Rows2, Maximize2, Minimize2, Plus, X, ChevronDown } from 'lucide-react';
import { TERMINAL_LIMITS, type Workspace } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { DetailDialog } from '../../ui/DetailDialog';
import { TerminalFrame } from './TerminalFrame';
import { TerminalLayout } from './TerminalLayout';
import {
  useTerminalStore,
  ensureInitialTerminal,
  openTerminalTab,
  activateTerminalTab,
  activateTerminalPane,
  closeTerminalTab,
  closeTerminalPane,
  addTerminalPane,
  terminalPaneIsActive,
  type TerminalTab,
} from './terminal-store';

type CloseRequest = { label: string; confirm: () => void };
function TerminalTabs({
  tabs,
  selected,
  close,
}: {
  tabs: TerminalTab[];
  selected?: string;
  close: (tab: TerminalTab) => void;
}) {
  return (
    <TabProvider
      selectedId={selected}
      setSelectedId={(id) => {
        if (id) activateTerminalTab(id);
      }}
    >
      <TabList aria-label="终端标签" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2">
        {tabs.map((tab) => (
          <div key={tab.id} className="flex shrink-0 items-center">
            <Tab
              id={tab.id}
              aria-controls={`terminal-surface-${tab.id}`}
              className={`max-w-64 truncate rounded-t px-3 py-2 text-xs ${tab.id === selected ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
              title={`${tab.name} · ${tab.target.sshHost} · 起始目录 ${tab.target.remoteDir}`}
            >
              {tab.name} · {tab.target.sshHost}
            </Tab>
            <button
              type="button"
              aria-label={`关闭终端标签 ${tab.name}`}
              className={buttonClass('ghost')}
              onClick={() => close(tab)}
            >
              <X aria-hidden className="size-3" />
            </button>
          </div>
        ))}
      </TabList>
    </TabProvider>
  );
}
function CloseDialog({ request, cancel }: { request: CloseRequest; cancel: () => void }) {
  return (
    <DetailDialog title={request.label} onClose={cancel}>
      <p className="text-sm leading-6">
        将断开对应 shell，不能保证其中的前台进程继续运行。长任务请使用服务器已有的后台提交方式。
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={buttonClass('outline')} onClick={cancel}>
          取消
        </button>
        <button
          type="button"
          className={buttonClass('primary')}
          onClick={() => {
            request.confirm();
            cancel();
          }}
        >
          确认断开
        </button>
      </div>
    </DetailDialog>
  );
}
function useCloseActions(active?: TerminalTab) {
  const [closeRequest, setCloseRequest] = useState<CloseRequest>();
  const activePane = active?.panes.find((pane) => pane.id === active.activePaneId);
  const closeTab = (tab: TerminalTab) => {
    if (tab.panes.some((pane) => terminalPaneIsActive(pane.status)))
      setCloseRequest({ label: '关闭终端标签', confirm: () => closeTerminalTab(tab.id) });
    else closeTerminalTab(tab.id);
  };
  const closePane = () => {
    if (!active || !activePane) return;
    const confirm = () => closeTerminalPane(active.id, activePane.id);
    if (terminalPaneIsActive(activePane.status)) setCloseRequest({ label: '关闭终端窗格', confirm });
    else confirm();
  };
  const replace = () => {
    if (!active || !activePane) return;
    const confirm = () => {
      void addTerminalPane(active.id, 'replace');
    };
    if (terminalPaneIsActive(activePane.status)) setCloseRequest({ label: '断开旧 shell 并新建连接', confirm });
    else confirm();
  };
  return { closeRequest, cancel: () => setCloseRequest(undefined), closeTab, closePane, replace };
}
function TerminalToolbar({
  workspace,
  active,
  maximized,
  onMaximize,
  onHide,
  closePane,
  replace,
}: {
  workspace?: Workspace;
  active?: TerminalTab;
  maximized: boolean;
  onMaximize: () => void;
  onHide: () => void;
  closePane: () => void;
  replace: () => void;
}) {
  const canSplit = !!active?.tree && !active.busy && active.panes.length < TERMINAL_LIMITS.panes;
  const canChange = !!active?.activePaneId && !active.busy;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
      <span className="mr-2 text-xs font-medium">终端</span>
      <button
        type="button"
        className={buttonClass('ghost')}
        disabled={!workspace}
        onClick={() => {
          if (workspace) void openTerminalTab(workspace);
        }}
      >
        <Plus aria-hidden className="size-3.5" />
        新建标签
      </button>
      <button
        type="button"
        className={buttonClass('ghost')}
        disabled={!canSplit}
        onClick={() => {
          if (active) void addTerminalPane(active.id, 'horizontal');
        }}
      >
        <Columns2 aria-hidden className="size-3.5" />
        左右分屏
      </button>
      <button
        type="button"
        className={buttonClass('ghost')}
        disabled={!canSplit}
        onClick={() => {
          if (active) void addTerminalPane(active.id, 'vertical');
        }}
      >
        <Rows2 aria-hidden className="size-3.5" />
        上下分屏
      </button>
      <button type="button" className={buttonClass('ghost')} disabled={!canChange} onClick={replace}>
        新建连接
      </button>
      <button type="button" className={buttonClass('ghost')} disabled={!canChange} onClick={closePane}>
        关闭窗格
      </button>
      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={buttonClass('ghost')} onClick={onMaximize}>
          {maximized ? <Minimize2 aria-hidden className="size-3.5" /> : <Maximize2 aria-hidden className="size-3.5" />}
          {maximized ? '还原' : '最大化'}
        </button>
        <button type="button" className={buttonClass('ghost')} onClick={onHide}>
          <ChevronDown aria-hidden className="size-3.5" />
          收起
        </button>
      </div>
    </div>
  );
}
function PaneSelector({ tab }: { tab: TerminalTab }) {
  return (
    <div
      role="group"
      aria-label="选择终端窗格"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2"
    >
      {tab.panes.map((pane, index) => (
        <button
          key={pane.id}
          type="button"
          className={buttonClass('ghost')}
          aria-pressed={pane.id === tab.activePaneId}
          onClick={() => activateTerminalPane(pane.id)}
        >
          窗格 {index + 1}
          <span className="text-muted-foreground">{pane.status.message}</span>
        </button>
      ))}
    </div>
  );
}
export default function TerminalDock({
  workspace,
  visible,
  overlay,
  onHide,
}: {
  workspace?: Workspace;
  visible: boolean;
  overlay: boolean;
  onHide: () => void;
}) {
  const tabs = useTerminalStore((state) => state.tabs);
  const selected = useTerminalStore((state) => state.activeTabId);
  const notice = useTerminalStore((state) => state.notice);
  const [maximized, setMaximized] = useState(false);
  const active = tabs.find((tab) => tab.id === selected);
  const message = active?.error ?? notice;
  const actions = useCloseActions(active);
  useEffect(() => ensureInitialTerminal(workspace), [workspace]);
  return (
    <TerminalFrame visible={visible} overlay={overlay || maximized} onHide={onHide}>
      <TerminalToolbar
        workspace={workspace}
        active={active}
        maximized={maximized}
        onMaximize={() => setMaximized((value) => !value)}
        onHide={onHide}
        closePane={actions.closePane}
        replace={actions.replace}
      />
      <TerminalTabs tabs={tabs} selected={selected} close={actions.closeTab} />
      {active && active.panes.length > 1 && <PaneSelector tab={active} />}
      {message && (
        <p role="status" className="shrink-0 px-3 py-1 text-xs text-warning">
          {message}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {tabs.map((tab) => (
          <TerminalLayout key={tab.id} tab={tab} shown={visible && tab.id === selected} />
        ))}
        {!tabs.length && (
          <p className="m-auto text-sm text-muted-foreground">新建标签以连接当前工作区；切换聊天不会改变已有终端。</p>
        )}
      </div>
      {actions.closeRequest && <CloseDialog request={actions.closeRequest} cancel={actions.cancel} />}
    </TerminalFrame>
  );
}
