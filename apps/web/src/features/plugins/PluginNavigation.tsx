import { Blocks, Puzzle, SquareTerminal } from 'lucide-react';
import type { WorkbenchPlugin } from '@agentdeck/shared';
import { useUiPreferences } from '../../ui/ui-preferences';
import { sidebarItemClass } from '../../app/SidebarActions';

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
    .toSorted((a, b) => Number(b.manifest.id === 'ssh-console') - Number(a.manifest.id === 'ssh-console'));
  return (
    <section aria-label="工作台页面" className="space-y-0.5">
      <button type="button" aria-label="插件" title="插件" onClick={manage} className={sidebarItemClass(collapsed)}>
        <Blocks aria-hidden className="size-4 shrink-0" />
        {!collapsed && <span>插件</span>}
      </button>
      {visible.map(({ manifest }) => {
        const Icon = manifest.id === 'ssh-console' ? SquareTerminal : Puzzle;
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
