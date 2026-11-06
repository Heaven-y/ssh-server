import type { AgentModel } from '@agentdeck/shared/conversation';
import { findModel, stripContext, extendedContext, displayId } from '../shared/model-identity';
/** 仅生成用户可选的原生参数；显示菜单不会追加后缀或修改原生配置。 */
export function claudeContextModels(id: string, models: AgentModel[]) {
  if (!id) return undefined;
  const candidate = findModel(models, id);
  const base = stripContext(id);
  // 别名自身已绑定 [1m] 时，去掉别名后缀并不能解除绑定；使用明确的底层型号。
  const bound = candidate?.id === base && extendedContext(candidate.modelId ?? '');
  return {
    standard: bound ? stripContext(candidate.modelId!) : base,
    extended: `${base}[1m]`,
    selected: extendedContext(displayId(id, candidate)),
  };
}
