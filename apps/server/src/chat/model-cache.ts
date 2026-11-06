import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { AgentKind } from '@agentdeck/shared/conversation';
import { inspectDirectory, MAX_CONFIG_BYTES, readConfigFile, writeConfigFile } from '../platform/files/safe-file';

const Model = z.object({
  id: z.string().min(1).max(512),
  label: z.string().max(512),
  description: z.string().max(2048).optional(),
  modelId: z.string().min(1).max(512).optional(),
  reasoningEfforts: z.array(z.string().max(100)).max(16).optional(),
  defaultReasoningEffort: z.string().min(1).max(100).optional(),
});
const Models = z.array(Model).max(512);
const ModelCatalog = z.object({
  models: Models,
  defaultModel: z.string().min(1).max(512).optional(),
  defaultReasoningEffort: z.string().min(1).max(100).optional(),
});
const Stored = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  catalogs: z.array(ModelCatalog.extend({ key: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(32),
});
type Catalogs = z.infer<typeof Stored>['catalogs'];
export type ModelCatalogSnapshot = z.infer<typeof ModelCatalog>;
export type CachedModelCatalog = { snapshot: ModelCatalogSnapshot; current: boolean };

function bounded(catalogs: Catalogs): Buffer | undefined {
  while (catalogs.length > 0) {
    const bytes = Buffer.from(JSON.stringify({ version: 2, catalogs }) + '\n');
    if (bytes.length <= MAX_CONFIG_BYTES) return bytes;
    catalogs.shift();
  }
  return undefined;
}

/** 只缓存模型元数据，目录用摘要标识；技能路径、诊断与认证材料不写入。 */
export function createModelCache(configDir: string) {
  const directory = path.join(path.resolve(configDir), 'model-cache');
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T | undefined> => {
    // 缓存不可用不能阻断 CLI 使用，也不把文件诊断回传给界面。
    const pending = queue.then(action, action).catch(() => undefined);
    queue = pending;
    return pending;
  };
  const hash = (key: string) => createHash('sha256').update(key).digest('hex');
  async function load(agent: AgentKind) {
    const parents = await inspectDirectory(directory);
    const file = path.join(directory, `${agent}.json`);
    const snapshot = parents ? await readConfigFile(file) : { content: '', revision: 'missing' };
    let catalogs: Catalogs = [];
    let version = 1;
    try {
      const parsed = Stored.parse(JSON.parse(snapshot.content));
      catalogs = parsed.catalogs;
      version = parsed.version;
    } catch {
      // 派生缓存可由下一次成功发现重建，不把损坏内容当作已获取模型。
    }
    return { file, snapshot, catalogs, version };
  }
  return {
    read: (agent: AgentKind, key: string) =>
      serial(async () => {
        const stored = await load(agent);
        const catalog = stored.catalogs.find((entry) => entry.key === hash(key));
        return catalog ? { snapshot: ModelCatalog.parse(catalog), current: stored.version === 2 } : undefined;
      }),
    write: (agent: AgentKind, key: string, catalog: ModelCatalogSnapshot, currentRequest: () => boolean) =>
      serial(async () => {
        const parsed = ModelCatalog.safeParse(catalog);
        if (!parsed.success || !currentRequest()) return;
        const current = await load(agent);
        const identity = hash(key);
        // v1 缺少模型身份与默认值，升级时只把本次新发现的目录标记为完整。
        const catalogs =
          current.version === 2 ? current.catalogs.filter((catalog) => catalog.key !== identity).slice(-31) : [];
        catalogs.push({ key: identity, ...parsed.data });
        const bytes = bounded(catalogs);
        if (!bytes) return;
        const parents = await inspectDirectory(directory, true);
        if (!currentRequest()) return;
        await writeConfigFile(current.file, bytes, current.snapshot, parents!);
        // 请求可能在磁盘写入期间被取消或替代；同一串行队列内还原后再放行新写入。
        if (!currentRequest()) {
          const updated = await readConfigFile(current.file);
          const previous = current.snapshot.content || '{"version":1,"catalogs":[]}\n';
          await writeConfigFile(current.file, Buffer.from(previous), updated, parents!);
        }
      }),
    invalidate: (agent: AgentKind) =>
      serial(async () => {
        const current = await load(agent);
        if (current.snapshot.revision === 'missing') return;
        const parents = await inspectDirectory(directory);
        await writeConfigFile(current.file, Buffer.from('{"version":1,"catalogs":[]}\n'), current.snapshot, parents!);
      }),
  };
}
