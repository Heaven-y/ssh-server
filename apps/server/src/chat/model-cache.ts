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
const Models = z.array(Model);
const ModelCatalog = z.object({
  models: Models,
  defaultModel: z.string().min(1).max(512).optional(),
  defaultReasoningEffort: z.string().min(1).max(100).optional(),
});
const LegacyStored = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  catalogs: z.array(ModelCatalog.extend({ key: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(32),
});
type Catalogs = z.infer<typeof LegacyStored>['catalogs'];
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Stored = z.strictObject({
  version: z.literal(3),
  directories: z.array(z.strictObject({ key: Digest, catalog: Digest })).max(32),
  catalogs: z.array(ModelCatalog.extend({ id: Digest }).strict()).max(32),
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const EMPTY_CACHE = '{"version":3,"directories":[],"catalogs":[]}\n';
export type ModelCatalogSnapshot = z.infer<typeof ModelCatalog>;
export type CachedModelCatalog = { snapshot: ModelCatalogSnapshot; current: boolean };

/** 不合并目录作用域；仅对已解析的公开模型快照做内容去重。 */
function encode(catalogs: Catalogs): Buffer {
  const unique = new Map<string, ModelCatalogSnapshot>();
  const directories = catalogs.map(({ key, ...catalog }) => {
    const identity = hash(JSON.stringify(catalog));
    unique.set(identity, catalog);
    return { key, catalog: identity };
  });
  const content = { version: 3, directories, catalogs: [...unique].map(([id, catalog]) => ({ id, ...catalog })) };
  return Buffer.from(JSON.stringify(content) + '\n');
}
function bounded(catalogs: Catalogs): Buffer | undefined {
  while (catalogs.length > 0) {
    const bytes = encode(catalogs);
    if (bytes.length <= MAX_CONFIG_BYTES) return bytes;
    catalogs.shift();
  }
  return undefined;
}
function decode(content: string): { catalogs: Catalogs; current: boolean } {
  const value: unknown = JSON.parse(content);
  const stored = Stored.safeParse(value);
  if (!stored.success) {
    const legacy = LegacyStored.parse(value);
    return { catalogs: legacy.catalogs, current: legacy.version === 2 };
  }
  const snapshots = new Map(stored.data.catalogs.map(({ id, ...catalog }) => [id, catalog]));
  return {
    current: true,
    catalogs: stored.data.directories.map(({ key, catalog }) => {
      const snapshot = snapshots.get(catalog);
      if (!snapshot) throw new Error('模型缓存引用缺失');
      return { key, ...snapshot };
    }),
  };
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
  async function load(agent: AgentKind) {
    const parents = await inspectDirectory(directory);
    const file = path.join(directory, `${agent}.json`);
    const snapshot = parents ? await readConfigFile(file) : { content: '', revision: 'missing' };
    let catalogs: Catalogs = [];
    let current = false;
    try {
      ({ catalogs, current } = decode(snapshot.content));
    } catch {
      // 派生缓存可由下一次成功发现重建，不把损坏内容当作已获取模型。
    }
    return { file, snapshot, catalogs, current };
  }
  return {
    read: (agent: AgentKind, key: string) =>
      serial(async () => {
        const stored = await load(agent);
        const catalog = stored.catalogs.find((entry) => entry.key === hash(key));
        return catalog ? { snapshot: ModelCatalog.parse(catalog), current: stored.current } : undefined;
      }),
    write: (agent: AgentKind, key: string, catalog: ModelCatalogSnapshot, currentRequest: () => boolean) =>
      serial(async () => {
        const parsed = ModelCatalog.safeParse(catalog);
        if (!parsed.success || !currentRequest()) return;
        const current = await load(agent);
        const identity = hash(key);
        // v1 缺少模型身份与默认值，升级时只把本次新发现的目录标记为完整。
        const catalogs = current.current
          ? current.catalogs.filter((catalog) => catalog.key !== identity).slice(-31)
          : [];
        catalogs.push({ key: identity, ...parsed.data });
        const bytes = bounded(catalogs);
        if (!bytes) return;
        const parents = await inspectDirectory(directory, true);
        if (!currentRequest()) return;
        await writeConfigFile(current.file, bytes, current.snapshot, parents!);
        // 请求可能在磁盘写入期间被取消或替代；同一串行队列内还原后再放行新写入。
        if (!currentRequest()) {
          const updated = await readConfigFile(current.file);
          const previous = current.snapshot.content || EMPTY_CACHE;
          await writeConfigFile(current.file, Buffer.from(previous), updated, parents!);
        }
      }),
    invalidate: (agent: AgentKind) =>
      serial(async () => {
        const current = await load(agent);
        if (current.snapshot.revision === 'missing') return;
        const parents = await inspectDirectory(directory);
        await writeConfigFile(current.file, Buffer.from(EMPTY_CACHE), current.snapshot, parents!);
      }),
  };
}
