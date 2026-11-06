import type { AgentKind, AgentModel } from '@agentdeck/shared';

const standardEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const stripContext = (id: string) => id.replace(/\[1m\]$/i, '');
const extendedContext = (id: string) => /\[1m\]$/i.test(id);

/** 只用于匹配元数据；调用 CLI 时始终使用用户选择的原始 id。 */
export function findModel(models: AgentModel[], id: string): AgentModel | undefined {
  const exact = models.find((model) => model.id === id);
  if (exact) return exact;
  const resolved = models.filter((model) => model.modelId === id);
  if (resolved.length === 1) return resolved[0];
  const base = models.filter((model) => stripContext(model.id) === stripContext(id));
  if (base.length === 1) return base[0];
  const underlying = models.filter((model) => stripContext(model.modelId ?? model.id) === stripContext(id));
  return underlying.length === 1 ? underlying[0] : undefined;
}

function displayId(id: string, candidate?: AgentModel): string {
  let resolved = candidate?.modelId || id;
  if (candidate && id !== candidate.id && !extendedContext(id)) resolved = stripContext(resolved);
  if (extendedContext(id) && !extendedContext(resolved)) resolved += '[1m]';
  return resolved;
}

export function modelDisplay(id: string, candidate?: AgentModel): string {
  if (!id) return '选择模型';
  const resolved = displayId(id, candidate);
  const label = candidate?.label;
  return label && label !== resolved ? `${label} · ${resolved}` : resolved;
}

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

/** 官方文档核对范围见 docs/engineering/model-capabilities.md，未确认型号不套家族规则。 */
const documentedModels: Array<{ pattern: RegExp; efforts: string[]; agents: AgentKind[] }> = [
  { pattern: /^gpt-(6-astra|6\.1-sol)$/, efforts: standardEfforts, agents: ['codex'] },
  {
    pattern: /^claude-(?:opus-(?:5-5|5|4-8|4-7)|sonnet-(?:5-5|5)|haiku-5-5|fable-(?:5-1|5))$/,
    efforts: standardEfforts,
    agents: ['claude', 'codex'],
  },
  { pattern: /^claude-(opus|sonnet)-4-6$/, efforts: ['low', 'medium', 'high', 'max'], agents: ['claude', 'codex'] },
  {
    pattern: /^deepseek-(?:flash|v4-flash|v4\.1-flash|v4-pro)$/,
    efforts: ['low', 'high', 'max'],
    agents: ['claude', 'codex'],
  },
  {
    pattern: /^kimi-(?:k3|k3\.1-pro|k3\.1-pro-highspeed)$/,
    efforts: ['low', 'high', 'max'],
    agents: ['claude', 'codex'],
  },
  { pattern: /^glm-5\.3$/, efforts: ['low', 'high', 'max'], agents: ['codex'] },
  { pattern: /^glm-5\.2$/, efforts: ['high', 'max'], agents: ['codex'] },
  {
    pattern: /^qwen3\.8-(?:max(?:-0902)?|flash|2\.4t-a95b|27b)$/,
    efforts: ['none', 'low', 'medium', 'xhigh'],
    agents: ['codex'],
  },
];
function documentedEfforts(agent: AgentKind, id: string): string[] {
  const model = stripContext(id).toLowerCase();
  return documentedModels.find((entry) => entry.agents.includes(agent) && entry.pattern.test(model))?.efforts ?? [];
}

function variant(id: string) {
  return /^(.*)-(low|medium|high|xhigh|max)$/.exec(id);
}

/** AGY 的强度是原生目录中的同族变体；自定义配置键不能按名称猜测。 */
function antigravityEfforts(id: string, models: AgentModel[]): string[] {
  const selected = findModel(models, id);
  if (!selected || selected.modelId) return [];
  const family = variant(selected.id)?.[1];
  if (!family) return [];
  const levels = models
    .filter((model) => !model.modelId && variant(model.id)?.[1] === family)
    .map((model) => variant(model.id)![2]);
  return levels.length > 1 ? standardEfforts.filter((level) => levels.includes(level)) : [];
}

export function modelEfforts(agent: AgentKind, id: string, models: AgentModel[]): string[] {
  const selected = findModel(models, id);
  const reported = selected?.reasoningEfforts;
  // [] 是明确不支持；undefined 才允许使用文档或原生变体补全。
  if (reported !== undefined)
    return [...new Set(reported)].filter((level) => agent === 'codex' || standardEfforts.includes(level));
  if (agent === 'antigravity') return antigravityEfforts(id, models);
  return documentedEfforts(agent, selected?.modelId ?? id);
}

export function modelDefaultEffort(agent: AgentKind, id: string, models: AgentModel[]): string | undefined {
  const selected = findModel(models, id);
  if (selected?.defaultReasoningEffort) return selected.defaultReasoningEffort;
  if (agent === 'antigravity' && !selected?.modelId) return variant(id)?.[2];
  return undefined;
}
