import { z } from 'zod';
import type { WorkbenchPluginManifest, Workspace } from '@agentdeck/shared';
import { pluginApi } from './plugin-api';

const Request = z.strictObject({
  type: z.literal('agentdeck.plugin.request'),
  id: z.string().min(1).max(80),
  method: z.enum(['storage.get', 'storage.set', 'project.get']),
  params: z.unknown().optional(),
});
const Storage = z.strictObject({ value: z.record(z.string(), z.json()), revision: z.string().max(80) });

/** 宿主仅提供清单声明的窄接口，绝不接受插件给出的HTTP路径或系统命令。 */
export async function handlePluginRequest(manifest: WorkbenchPluginManifest, data: unknown, project?: Workspace) {
  const input = Request.parse(data);
  if (JSON.stringify(data).length > 65536) throw new Error('插件请求超过限制');
  const permission = input.method === 'project.get' ? 'project-context' : 'storage';
  if (!manifest.permissions.includes(permission)) throw new Error('插件未声明此权限');
  switch (input.method) {
    case 'project.get':
      return project ? { id: project.id, name: project.name, dir: project.dir } : null;
    case 'storage.get':
      return pluginApi.storage(manifest.id);
    case 'storage.set':
      return pluginApi.saveStorage(manifest.id, Storage.parse(input.params));
  }
}

const POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';";
/** 自包含文档在不含 same-origin 权限的 iframe 里运行，所有宿主调用经消息校验。 */
export function pluginDocument(html: string) {
  const sdk = `(() => {
    const pending = new Map();
    addEventListener('message', event => {
      if (event.source !== parent || event.data?.type !== 'agentdeck.plugin.response') return;
      const item = pending.get(event.data.id); if (!item) return;
      pending.delete(event.data.id); clearTimeout(item.timer);
      event.data.error ? item.reject(new Error(event.data.error)) : item.resolve(event.data.result);
    });
    const request = (method, params) => new Promise((resolve, reject) => {
      if (pending.size >= 16) return reject(new Error('请求过多'));
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('宿主响应超时')); }, 10000);
      pending.set(id, {resolve, reject, timer});
      parent.postMessage({type:'agentdeck.plugin.request',id,method,params}, '*');
    });
    Object.defineProperty(window, 'agentdeck', { value: Object.freeze({
      version: 1, storage: Object.freeze({get: () => request('storage.get'), set: value => request('storage.set', value)}),
      project: Object.freeze({get: () => request('project.get')}),
      onCommand: listener => { const callback = event => {
        if(event.source === parent && event.data?.type === 'agentdeck.plugin.command') listener(event.data.id);
      }; addEventListener('message', callback); return () => removeEventListener('message', callback); }
    }) });
  })();`;
  return `<meta http-equiv="Content-Security-Policy" content="${POLICY}"><script>${sdk}</script>${html}`;
}
