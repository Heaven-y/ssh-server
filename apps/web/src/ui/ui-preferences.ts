import { create } from 'zustand';

const SIZES = {
  sidebarWidth: [240, 200, 320],
  fileWidth: [420, 360, 960],
  resourceWidth: [320, 280, 640],
  rightWidth: [420, 360, 720],
  wideToolsWidth: [760, 646, 1400],
  resourceShare: [43, 20, 80],
  resourceHeight: [40, 20, 80],
} as const;
type SizeKey = keyof typeof SIZES;
export type UiWidthKey = Exclude<SizeKey, 'resourceShare' | 'resourceHeight'>;
type SplitKey = 'resourceShare' | 'resourceHeight';
type UiPreferences = { theme: 'dark' | 'light'; sidebarCollapsed: boolean } & Record<SizeKey, number>;
const sizeKeys = Object.keys(SIZES) as SizeKey[];
const KEY = 'ssh-server.ui.v1';
const DEFAULTS: UiPreferences = {
  theme: 'light',
  sidebarCollapsed: false,
  ...(Object.fromEntries(sizeKeys.map((key) => [key, SIZES[key][0]])) as Record<SizeKey, number>),
};
const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
function isPreferences(value: unknown): value is UiPreferences & { version: 1 } {
  if (!value || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return (
    fields.version === 1 &&
    (fields.theme === 'dark' || fields.theme === 'light') &&
    typeof fields.sidebarCollapsed === 'boolean' &&
    bounded(fields.sidebarWidth, 200, 320) &&
    bounded(fields.fileWidth, 360, 960)
  );
}
function read(): UiPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!isPreferences(value)) return DEFAULTS;
    return {
      theme: value.theme,
      sidebarCollapsed: value.sidebarCollapsed,
      ...(Object.fromEntries(
        sizeKeys.map((key) => {
          const [initial, min, max] = SIZES[key];
          return [key, bounded(value[key], min, max) ? value[key] : initial];
        }),
      ) as Record<SizeKey, number>),
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
  sidebarAutoCollapsed: boolean;
  toggleTheme(): void;
  setSidebarCollapsed(value: boolean): void;
  setSidebarAutoCollapsed(value: boolean): void;
  setWidth(panel: UiWidthKey, value: number): void;
  setSplit(panel: SplitKey, value: number): void;
  resetDockedSizes(): void;
};
export const useUiPreferences = create<State>((set, get) => {
  const update = (patch: Partial<UiPreferences>) => {
    const current = get();
    const next = {
      theme: current.theme,
      sidebarCollapsed: current.sidebarCollapsed,
      ...(Object.fromEntries(sizeKeys.map((key) => [key, current[key]])) as Record<SizeKey, number>),
      ...patch,
    };
    persist(next);
    set(patch);
  };
  const setSize = (panel: SizeKey, value: number) => {
    const [, min, max] = SIZES[panel];
    if (bounded(value, min, max) && value !== get()[panel]) update({ [panel]: value });
  };
  return {
    ...read(),
    sidebarAutoCollapsed: false,
    toggleTheme: () => update({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
    setSidebarCollapsed: (value) => {
      set({ sidebarAutoCollapsed: false });
      if (value !== get().sidebarCollapsed) update({ sidebarCollapsed: value });
    },
    setSidebarAutoCollapsed: (value) => {
      if (value !== get().sidebarAutoCollapsed) set({ sidebarAutoCollapsed: value });
    },
    setWidth: setSize,
    setSplit: setSize,
    resetDockedSizes: () =>
      update(Object.fromEntries(sizeKeys.filter((key) => key !== 'sidebarWidth').map((key) => [key, SIZES[key][0]]))),
  };
});
