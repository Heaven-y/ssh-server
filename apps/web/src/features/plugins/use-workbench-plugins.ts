import { useQuery } from '@tanstack/react-query';
import { pluginApi, pluginsKey } from './plugin-api';

export function useWorkbenchPlugins() {
  return useQuery({ queryKey: pluginsKey, queryFn: ({ signal }) => pluginApi.list(signal), retry: false });
}
