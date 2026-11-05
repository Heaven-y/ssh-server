import { useEffect, useRef, useState } from 'react';
import type { WorkbenchPlugin, Workspace } from '@agentdeck/shared';
import { pluginApi } from './plugin-api';
import { handlePluginRequest, pluginDocument } from './plugin-bridge';

export default function PluginFrame({
  plugin,
  project,
  command,
}: {
  plugin: WorkbenchPlugin;
  project?: Workspace;
  command?: { id: string; sequence: number };
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const currentProject = useRef(project);
  const [document, setDocument] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    currentProject.current = project;
  }, [project]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let requests = 0;
    let remaining = 60;
    const timer = setInterval(() => {
      remaining = 60;
    }, 1000);
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      const data = event.data as Record<string, unknown>;
      if (data.type !== 'agentdeck.plugin.request' || typeof data.id !== 'string' || requests >= 16 || --remaining < 0)
        return;
      const target = frame.current?.contentWindow;
      requests++;
      void handlePluginRequest(plugin.manifest, data, currentProject.current)
        .then(
          (result) => {
            if (active) target?.postMessage({ type: 'agentdeck.plugin.response', id: data.id, result }, '*');
          },
          () => {
            if (active)
              target?.postMessage(
                { type: 'agentdeck.plugin.response', id: data.id, error: '请求失败，请检查插件权限与设置版本。' },
                '*',
              );
          },
        )
        .finally(() => {
          requests--;
        });
    };
    window.addEventListener('message', receive);
    void pluginApi
      .page(plugin.manifest.id, controller.signal)
      .then((page) => {
        if (active) setDocument(pluginDocument(page.html));
      })
      .catch(() => {
        if (active) setError('插件页面无法加载，请核对插件是否已启用。');
      });
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('message', receive);
    };
  }, [plugin]);
  const sendCommand = () => {
    if (command) frame.current?.contentWindow?.postMessage({ type: 'agentdeck.plugin.command', id: command.id }, '*');
  };
  useEffect(sendCommand, [command]);
  if (error)
    return (
      <p role="alert" className="p-4 text-sm text-destructive-foreground">
        {error}
      </p>
    );
  if (!document)
    return (
      <p role="status" className="p-4 text-sm">
        正在打开插件…
      </p>
    );
  return (
    <iframe
      ref={frame}
      title={plugin.manifest.name}
      srcDoc={document}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="h-full min-h-0 w-full border-0 bg-background"
      onLoad={sendCommand}
    />
  );
}
