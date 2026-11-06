import { useState } from 'react';
import { useWorkbenchPlugins } from './use-workbench-plugins';
import { allowConversationNavigation } from '../chat/chat-store';

export function usePluginPages() {
  const [id, select] = useState<string>();
  const [managerOpen, setManagerOpen] = useState(false);
  const [command, setCommand] = useState<{ pluginId: string; id: string; sequence: number }>();
  const show = (value?: string) => {
    if (value && !allowConversationNavigation()) return;
    select(value);
    setCommand(undefined);
  };
  const query = useWorkbenchPlugins();
  const list = query.data?.plugins ?? [];
  const active = list.find((plugin) => plugin.manifest.id === id && plugin.enabled);
  const commands = list
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) =>
      plugin.manifest.commands.map((entry) => ({
        id: `${plugin.manifest.id}:${entry.id}`,
        label: entry.title,
        run: () => {
          if (!allowConversationNavigation()) return false;
          select(plugin.manifest.id);
          setCommand((current) => ({
            pluginId: plugin.manifest.id,
            id: entry.id,
            sequence: (current?.sequence ?? 0) + 1,
          }));
          return true;
        },
      })),
    );
  const builtinPlugins = list.filter((plugin) => plugin.builtin && plugin.enabled);
  return {
    list,
    active,
    builtinPlugins,
    selected: active?.manifest.id,
    show,
    command: command?.pluginId === id ? command : undefined,
    commands,
    managerOpen,
    setManagerOpen,
  };
}
