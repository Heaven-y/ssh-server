import { builtinPlugins } from '../../builtin-plugins/registry';
import { Blocks, Puzzle } from 'lucide-react';
import type { WorkbenchPlugin } from '@agentdeck/shared/plugins';
import { useUiPreferences } from '../../ui/ui-preferences';
import { sidebarItemClass } from '../../ui/sidebar-styles';

export function PluginNavigation({
  plugins,
  selected,
  open,
  manage,
}: {
  plugins: WorkbenchPlugin[];
  selected?: string;
  open(id?: string): void;
  manage(): void;
}) {
  const collapsed = useUiPreferences((state) => state.sidebarCollapsed || state.sidebarAutoCollapsed);
  const visible = plugins
    .filter((plugin) => plugin.enabled)
    .toSorted(
      (a, b) => (builtinPlugins[b.manifest.id]?.priority ?? 0) - (builtinPlugins[a.manifest.id]?.priority ?? 0),
    );
  return (
    <section aria-label="工作台页面" className="space-y-0.5">
      <button type="button" aria-label="插件" title="插件" onClick={manage} className={sidebarItemClass(collapsed)}>
        <Blocks aria-hidden className="size-4 shrink-0" />
        {!collapsed && <span>插件</span>}
      </button>
      {visible.map(({ manifest }) => {
        const Icon = builtinPlugins[manifest.id]?.Icon ?? Puzzle;
        return (
          <button
            key={manifest.id}
            type="button"
            aria-label={manifest.name}
            title={manifest.name}
            aria-current={selected === manifest.id ? 'page' : undefined}
            onClick={() => open(manifest.id)}
            className={`${sidebarItemClass(collapsed)} aria-[current]:bg-muted`}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{manifest.name}</span>}
          </button>
        );
      })}
    </section>
  );
}
