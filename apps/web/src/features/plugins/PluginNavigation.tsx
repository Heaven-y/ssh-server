import { Puzzle, MessageSquare, Settings2 } from 'lucide-react';
import type { WorkbenchPlugin } from '@agentdeck/shared';

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
  return (
    <section aria-label="工作台页面" className="shrink-0 space-y-1 border-b border-border p-2">
      <button
        type="button"
        aria-current={!selected ? 'page' : undefined}
        onClick={() => open()}
        className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-sm hover:bg-muted aria-[current]:bg-muted"
      >
        <MessageSquare aria-hidden className="size-4" />
        对话
      </button>
      {plugins
        .filter((plugin) => plugin.enabled)
        .map(({ manifest }) => (
          <button
            key={manifest.id}
            type="button"
            aria-current={selected === manifest.id ? 'page' : undefined}
            onClick={() => open(manifest.id)}
            className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-muted aria-[current]:bg-muted"
          >
            <Puzzle aria-hidden className="size-4" />
            <span className="truncate">{manifest.name}</span>
          </button>
        ))}
      <button
        type="button"
        onClick={manage}
        className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-muted-foreground hover:bg-muted"
      >
        <Settings2 aria-hidden className="size-3.5" />
        管理工作台插件
      </button>
    </section>
  );
}
