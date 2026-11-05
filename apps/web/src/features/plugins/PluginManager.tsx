import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkbenchPlugin, WorkbenchPluginCatalog } from '@agentdeck/shared';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass, inputClass } from '../../ui/styles';
import { pluginApi, pluginsKey } from './plugin-api';
import { useWorkbenchPlugins } from './use-workbench-plugins';
import { closeTerminalTab, useTerminalStore } from '../terminal/terminal-store';

const permissions = { storage: '插件自己的本机设置', 'project-context': '当前项目名称和目录' };
async function togglePlugin(plugin: WorkbenchPlugin, revision: string) {
  const catalog = await pluginApi.setEnabled(plugin.manifest.id, !plugin.enabled, revision);
  if (plugin.enabled && plugin.manifest.id === 'ssh-console') {
    // 停用成功后清理旧终端及待绑定操作，重新启用时由用户新建 shell。
    for (const tab of useTerminalStore.getState().tabs) closeTerminalTab(tab.id);
  }
  return catalog;
}

function PluginEntry({
  plugin,
  busy,
  toggle,
  remove,
}: {
  plugin: WorkbenchPlugin;
  busy: boolean;
  toggle(): void;
  remove(): void;
}) {
  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{plugin.manifest.name}</h3>
        <span className="text-xs text-muted-foreground">
          {plugin.builtin ? '内置' : plugin.manifest.version} · {plugin.enabled ? '已启用' : '已停用'}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{plugin.manifest.description}</p>
      <p className="text-xs text-muted-foreground">
        可访问：{plugin.manifest.permissions.map((item) => permissions[item]).join('、') || '仅插件页面'}
      </p>
      <div className="flex gap-2">
        <button type="button" className={buttonClass('outline')} disabled={busy} onClick={toggle}>
          {plugin.enabled ? `停用 ${plugin.manifest.name}` : `启用 ${plugin.manifest.name}`}
        </button>
        {!plugin.builtin && (
          <button type="button" className={buttonClass('danger')} disabled={busy} onClick={remove}>
            卸载 {plugin.manifest.name}
          </button>
        )}
      </div>
    </li>
  );
}

export default function PluginManager({ onClose }: { onClose(): void }) {
  const query = useWorkbenchPlugins();
  const client = useQueryClient();
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const perform = async (action: () => Promise<WorkbenchPluginCatalog>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await client.cancelQueries({ queryKey: pluginsKey });
      client.setQueryData(pluginsKey, await action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '插件操作失败，请重新读取');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const toggle = (plugin: WorkbenchPlugin) => {
    if (!query.data) return;
    const ended = plugin.manifest.id === 'ssh-console' ? '，包括项目服务器工具中的终端' : '';
    const text = plugin.enabled
      ? `停用“${plugin.manifest.name}”将关闭它的页面与资源${ended}。服务器档案、项目和任务记录保留。继续吗？`
      : `启用“${plugin.manifest.name}”，允许访问：${plugin.manifest.permissions.map((item) => permissions[item]).join('、') || '仅插件页面'}？`;
    if (window.confirm(text)) void perform(() => togglePlugin(plugin, query.data.revision));
  };
  const remove = (plugin: WorkbenchPlugin) => {
    if (query.data && window.confirm(`卸载“${plugin.manifest.name}”？这会清理插件副本与插件自己的设置。`))
      void perform(() => pluginApi.remove(plugin.manifest.id, query.data.revision));
  };
  return (
    <DetailDialog title="工作台插件" busy={busy} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted-foreground">
          在这里增加工作台页面。CLI 自己的插件请在对应原生配置中管理。
        </p>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (directory.trim()) void perform(() => pluginApi.install(directory.trim()));
          }}
        >
          <label className="block space-y-2 text-sm">
            本地插件目录
            <input
              className={inputClass}
              value={directory}
              disabled={busy}
              placeholder="包含 agentdeck.plugin.json 的目录"
              onChange={(event) => setDirectory(event.target.value)}
            />
          </label>
          <button type="submit" className={buttonClass('primary')} disabled={busy || !directory.trim()}>
            安装本地插件
          </button>
          <p className="text-xs text-muted-foreground">安装后默认停用，可查看权限再启用。支持 AgentDeck 插件格式。</p>
        </form>
        {(error || query.error) && (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error || query.error?.message}
          </p>
        )}
        {query.isPending ? (
          <p role="status">正在读取插件…</p>
        ) : (
          <ul className="space-y-3">
            {query.data?.plugins.map((plugin) => (
              <PluginEntry
                key={plugin.manifest.id}
                plugin={plugin}
                busy={busy}
                toggle={() => toggle(plugin)}
                remove={() => remove(plugin)}
              />
            ))}
          </ul>
        )}
        <button
          type="button"
          className={buttonClass('outline')}
          disabled={busy || query.isFetching}
          onClick={() => void query.refetch()}
        >
          重新读取插件
        </button>
      </div>
    </DetailDialog>
  );
}
