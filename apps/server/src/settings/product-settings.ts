import {
  ProductSettingsInputSchema,
  ProductSettingsSchema,
  type ProductSettingsDocument,
  type ProductSettingsInput,
} from '@agentdeck/shared/settings';
import path from 'node:path';
import { NativeConfigError, anonymousConfigError } from '../agents/common/configuration/legacy-errors';
import { inspectDirectory, readConfigFile, writeConfigFile } from '../platform/files/safe-file';

export class ProductSettingsError extends Error {
  constructor(
    readonly code: 'settings_invalid' | 'invalid_request',
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function retireSettings(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const settings = input as Record<string, unknown>;
  for (const key of ['defaultModels', 'syncDefaults', 'syncIntervalSeconds']) delete settings[key];
  const spotlight = settings.spotlight;
  if (spotlight && typeof spotlight === 'object' && !Array.isArray(spotlight))
    for (const key of ['color', 'intensity', 'size', 'softness']) delete (spotlight as Record<string, unknown>)[key];
  return settings;
}
/** 产品偏好与原生Agent配置分文件保存，缺失时只返回默认值。 */
export function createProductSettings({ configDir }: { configDir: string }) {
  const directory = path.resolve(configDir);
  const file = path.join(directory, 'product-settings.json');
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>) => {
    const run = queue.then(operation, operation);
    queue = run.catch(() => undefined);
    return run.catch((error: unknown) => {
      throw error instanceof ProductSettingsError ? error : anonymousConfigError(error);
    });
  };
  async function load() {
    const parents = await inspectDirectory(directory);
    const snapshot = parents ? await readConfigFile(file) : { content: '', revision: 'missing' };
    let settings;
    try {
      const input: unknown = snapshot.revision === 'missing' ? {} : JSON.parse(snapshot.content);
      // 仅磁盘读取迁移已退休字段；公开输入仍严格校验，原文件在显式保存前保持不变。
      settings = ProductSettingsSchema.parse(retireSettings(input));
    } catch {
      throw new ProductSettingsError('settings_invalid', 503, '产品设置文件无效，原文件已保留；请核对后重新读取');
    }
    return { snapshot, document: { settings, revision: snapshot.revision } };
  }
  return {
    read(): Promise<ProductSettingsDocument> {
      return serial(async () => (await load()).document);
    },
    save(input: ProductSettingsInput): Promise<ProductSettingsDocument> {
      return serial(async () => {
        const parsed = ProductSettingsInputSchema.safeParse(input);
        if (!parsed.success) throw new ProductSettingsError('invalid_request', 400, '请检查产品设置的字段与数值范围');
        const { snapshot } = await load();
        if (snapshot.revision !== parsed.data.revision) throw new NativeConfigError('revision_conflict');
        const parents = await inspectDirectory(directory, true);
        const data = Buffer.from(JSON.stringify(parsed.data.settings, null, 2) + '\n');
        await writeConfigFile(file, data, snapshot, parents!);
        return (await load()).document;
      });
    },
  };
}
export type ProductSettingsStore = ReturnType<typeof createProductSettings>;
