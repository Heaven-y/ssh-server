import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { SessionError } from '../chat/sessions';

/** 只映射 effort，不修改独立的 thinking、快模式或权限设置。 */
export function claudeEffort(value?: string): Options['effort'] {
  if (value === undefined) return undefined;
  switch (value) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return value;
    default:
      throw new SessionError(400, 'effort_unsupported', 'Claude 推理强度可选 low、medium、high、xhigh 或 max');
  }
}
