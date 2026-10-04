import { create } from 'zustand';
import {
  TERMINAL_LIMITS,
  TerminalBindingSchema,
  workspaceTerminalTarget,
  type Workspace,
  type TerminalTarget,
  type TerminalBinding,
} from '@ssh-server/shared';
import { api, ApiError } from '../../lib/api';
import type { TerminalPaneStatus } from './runtime';
import { splitPane, removePane, replacePaneId, type TerminalLayoutNode } from './layout';

export type TerminalPaneInfo = { id: string; target: TerminalTarget; binding: string; status: TerminalPaneStatus };
export type TerminalTab = {
  id: string;
  name: string;
  target: TerminalTarget;
  binding?: TerminalBinding;
  tree?: TerminalLayoutNode;
  panes: TerminalPaneInfo[];
  activePaneId?: string;
  busy: boolean;
  error?: string;
};
type State = { tabs: TerminalTab[]; activeTabId?: string; initialized: boolean; notice: string };
export const useTerminalStore = create<State>(() => ({ tabs: [], initialized: false, notice: '' }));
const pending = new Map<string, AbortController>();
function clearPending(id: string, controller: AbortController) {
  if (pending.get(id) === controller) pending.delete(id);
}
function canAddPane(tab: TerminalTab, action: string) {
  if (action === 'replace' || tab.panes.length < TERMINAL_LIMITS.panes) return true;
  useTerminalStore.setState({ notice: '每个标签最多4个终端窗格' });
  return false;
}
const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : '终端绑定不可用，请检查连接后重试';
const pane = (binding: TerminalBinding): TerminalPaneInfo => ({
  id: crypto.randomUUID(),
  target: binding.target,
  binding: binding.binding,
  status: { phase: 'connecting', message: '正在开启终端…' },
});
function updateTab(id: string, update: (tab: TerminalTab) => TerminalTab) {
  useTerminalStore.setState((state) => ({ tabs: state.tabs.map((tab) => (tab.id === id ? update(tab) : tab)) }));
}
export async function openTerminalTab(workspace: Workspace): Promise<void> {
  const id = crypto.randomUUID();
  const target = workspaceTerminalTarget(workspace);
  const controller = new AbortController();
  pending.set(id, controller);
  useTerminalStore.setState((state) => ({
    activeTabId: id,
    tabs: [...state.tabs, { id, name: workspace.name, target, panes: [], busy: true }],
  }));
  try {
    const binding = TerminalBindingSchema.parse(await api.bindTerminalTarget(target, { signal: controller.signal }));
    if (controller.signal.aborted) return;
    const first = pane(binding);
    updateTab(id, (tab) => ({
      ...tab,
      binding,
      panes: [first],
      tree: { kind: 'pane', paneId: first.id },
      activePaneId: first.id,
      busy: false,
    }));
  } catch (error) {
    if (!controller.signal.aborted) updateTab(id, (tab) => ({ ...tab, busy: false, error: errorMessage(error) }));
  } finally {
    if (pending.get(id) === controller) pending.delete(id);
  }
}
export function ensureInitialTerminal(workspace?: Workspace) {
  if (!workspace || useTerminalStore.getState().initialized) return;
  useTerminalStore.setState({ initialized: true });
  void openTerminalTab(workspace);
}
export function activateTerminalTab(id: string) {
  useTerminalStore.setState({ activeTabId: id });
}
export const activateTerminalPane = (id: string) => {
  const tab = useTerminalStore.getState().tabs.find((item) => item.panes.some((item) => item.id === id));
  if (tab && tab.activePaneId !== id) updateTab(tab.id, (item) => ({ ...item, activePaneId: id }));
};
export const setTerminalPaneStatus = (id: string, status: TerminalPaneStatus) => {
  const tab = useTerminalStore.getState().tabs.find((item) => item.panes.some((item) => item.id === id));
  if (tab)
    updateTab(tab.id, (item) => ({
      ...item,
      panes: item.panes.map((item) => (item.id === id ? { ...item, status } : item)),
    }));
};
export function closeTerminalTab(id: string) {
  pending.get(id)?.abort();
  pending.delete(id);
  useTerminalStore.setState((state) => {
    const index = state.tabs.findIndex((tab) => tab.id === id);
    const tabs = state.tabs.filter((tab) => tab.id !== id);
    return { tabs, activeTabId: state.activeTabId === id ? tabs[Math.max(0, index - 1)]?.id : state.activeTabId };
  });
}
export function closeTerminalPane(tabId: string, id: string) {
  const tab = useTerminalStore.getState().tabs.find((tab) => tab.id === tabId);
  if (!tab?.tree) return;
  if (tab.panes.length === 1) {
    closeTerminalTab(tabId);
    return;
  }
  updateTab(tabId, (item) => {
    const panes = item.panes.filter((item) => item.id !== id);
    return {
      ...item,
      panes,
      tree: removePane(item.tree!, id),
      activePaneId: item.activePaneId === id ? panes[0]?.id : item.activePaneId,
    };
  });
}
export async function addTerminalPane(tabId: string, action: 'horizontal' | 'vertical' | 'replace'): Promise<void> {
  const tab = useTerminalStore.getState().tabs.find((tab) => tab.id === tabId);
  if (!tab?.binding || !tab.tree || !tab.activePaneId || tab.busy) return;
  if (!canAddPane(tab, action)) return;
  const controller = new AbortController();
  pending.set(tabId, controller);
  updateTab(tabId, (item) => ({ ...item, busy: true, error: undefined }));
  try {
    const binding = TerminalBindingSchema.parse(
      await api.bindTerminalTarget(tab.target, { previousBinding: tab.binding.binding, signal: controller.signal }),
    );
    if (controller.signal.aborted) return;
    const next = pane(binding);
    updateTab(tabId, (item) => {
      if (!item.tree || !item.panes.some((item) => item.id === tab.activePaneId)) return { ...item, busy: false };
      const tree =
        action === 'replace'
          ? replacePaneId(item.tree, tab.activePaneId!, next.id)
          : splitPane(item.tree, tab.activePaneId!, next.id, action);
      const panes =
        action === 'replace'
          ? item.panes.map((item) => (item.id === tab.activePaneId ? next : item))
          : [...item.panes, next];
      return { ...item, binding, tree, panes, activePaneId: next.id, busy: false };
    });
  } catch (error) {
    if (!controller.signal.aborted) updateTab(tabId, (item) => ({ ...item, busy: false, error: errorMessage(error) }));
  } finally {
    clearPending(tabId, controller);
  }
}
export const terminalPaneIsActive = (status: TerminalPaneStatus) =>
  ['connecting', 'ready', 'paused'].includes(status.phase);
