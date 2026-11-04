import type { NativeCapabilityCatalog } from '../capability-types';

/** agy 当前只公开文本目录，不猜测标识或把 TUI 命令冒充可调用能力。 */
export function discoverAntigravityCapabilities(): Promise<NativeCapabilityCatalog> {
  return Promise.resolve({
    entries: [],
    models: [],
    warnings: [
      'Antigravity 暂未接入结构化模型与命令目录。可沿用原生配置，或在模型选项中显式填写模型 ID；原生规则、技能和插件仍由 agy 加载。',
    ],
  });
}
