import { create } from 'zustand';

type UiPreferences = { theme: 'dark' | 'light'; sidebarCollapsed: boolean; sidebarWidth: number; fileWidth: number };
const KEY = 'ssh-server.ui.v1';
const DEFAULTS: UiPreferences = { theme: 'dark', sidebarCollapsed: false, sidebarWidth: 240, fileWidth: 420 };
const bounded = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
function isPreferences(value: unknown): value is UiPreferences & { version: 1 } {
  if (!value || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return (
    fields.version === 1 &&
    (fields.theme === 'dark' || fields.theme === 'light') &&
    typeof fields.sidebarCollapsed === 'boolean' &&
    bounded(fields.sidebarWidth, 200, 320) &&
    bounded(fields.fileWidth, 360, 520)
  );
}
function read(): UiPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!isPreferences(value)) return DEFAULTS;
    return {
      theme: value.theme,
      sidebarCollapsed: value.sidebarCollapsed,
      sidebarWidth: value.sidebarWidth,
      fileWidth: value.fileWidth,
    };
  } catch {
    return DEFAULTS;
  }
}
function persist(preferences: UiPreferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, ...preferences }));
  } catch {
    /* 存储不可用时保留当前页面的内存偏好。 */
  }
}
type State = UiPreferences & {
  toggleTheme(): void;
  setSidebarCollapsed(value: boolean): void;
  setWidth(panel: 'sidebarWidth' | 'fileWidth', value: number): void;
};
export const useUiPreferences = create<State>((set, get) => {
  const update = (patch: Partial<UiPreferences>) => {
    const current = get();
    const next = {
      theme: current.theme,
      sidebarCollapsed: current.sidebarCollapsed,
      sidebarWidth: current.sidebarWidth,
      fileWidth: current.fileWidth,
      ...patch,
    };
    persist(next);
    set(patch);
  };
  return {
    ...read(),
    toggleTheme: () => update({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
    setSidebarCollapsed: (value) => {
      if (value !== get().sidebarCollapsed) update({ sidebarCollapsed: value });
    },
    setWidth: (panel, value) => {
      const [min, max] = panel === 'sidebarWidth' ? [200, 320] : [360, 520];
      if (bounded(value, min, max) && value !== get()[panel]) update({ [panel]: value });
    },
  };
});
