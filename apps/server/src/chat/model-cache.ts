import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { AgentKind, AgentModel } from '@agentdeck/shared';
import { inspectDirectory, MAX_CONFIG_BYTES, readConfigFile, writeConfigFile } from '../settings/safe-file';

const Model = z.object({
  id: z.string().min(1).max(512),
  label: z.string().max(512),
  description: z.string().max(2048).optional(),
  reasoningEfforts: z.array(z.string().max(100)).max(16).optional(),
});
const Models = z.array(Model).max(512);
const Stored = z.strictObject({
  version: z.literal(1),
  catalogs: z.array(z.strictObject({ key: z.string().regex(/^[a-f0-9]{64}$/), models: Models })).max(32),
});
type Catalogs = z.infer<typeof Stored>['catalogs'];

function bounded(catalogs: Catalogs): Buffer | undefined {
  while (catalogs.length > 0) {
    const bytes = Buffer.from(JSON.stringify({ version: 1, catalogs }) + '\n');
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
    try {
      catalogs = Stored.parse(JSON.parse(snapshot.content)).catalogs;
    } catch {
      // 派生缓存可由下一次成功发现重建，不把损坏内容当作已获取模型。
    }
    return { file, snapshot, catalogs };
  }
  return {
    read: (agent: AgentKind, key: string) =>
      serial(async () => (await load(agent)).catalogs.find((catalog) => catalog.key === hash(key))?.models),
    write: (agent: AgentKind, key: string, models: AgentModel[], currentRequest: () => boolean) =>
      serial(async () => {
        const parsed = Models.safeParse(models);
        if (!parsed.success || !currentRequest()) return;
        const current = await load(agent);
        const identity = hash(key);
        const catalogs = current.catalogs.filter((catalog) => catalog.key !== identity).slice(-31);
        catalogs.push({ key: identity, models: parsed.data });
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
