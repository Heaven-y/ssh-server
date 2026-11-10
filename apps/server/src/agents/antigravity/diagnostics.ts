import type { AgentEvent } from '@agentdeck/shared/conversation';
import { stripVTControlCharacters } from 'node:util';

type DiagnosticEvent = Extract<AgentEvent, { type: 'error' | 'activity' }>;

export const ANTIGRAVITY_PERMISSION_NOTICE =
  'Antigravity 拒绝了需要确认的工具操作；无交互模式无法完成这次确认。请检查原生权限（permissions）规则，本应用不会自动放行。';

function serviceDiagnostic(line: string, source: 'run' | 'tool'): DiagnosticEvent | undefined {
  if (/\b(?:error|http|status(?:[_ ]code)?)[\s:="']*524\b/i.test(line))
    return {
      type: 'error',
      message: 'Antigravity 的模型服务响应超时（HTTP 524），本轮未完成。请稍后重试或检查原生模型服务。',
    };
  if (source === 'run' && /\b(?:error|http|status(?:[_ ]code)?)[\s:="']*500\b/i.test(line))
    return {
      type: 'error',
      message: 'Antigravity 的模型服务返回内部错误（HTTP 500），本轮未完成。请检查当前模型服务或稍后重试。',
    };
  if (
    /\b(?:error|http|status(?:[_ ]code)?)[\s:="']*503\b|\bstatus\s*[:=]\s*UNAVAILABLE\b|"status"\s*:\s*"UNAVAILABLE"/i.test(
      line,
    )
  )
    return {
      type: 'error',
      message: 'Antigravity 的模型服务暂时不可用（503 / UNAVAILABLE），请稍后重试或检查原生模型服务配置。',
    };
  return undefined;
}

/** 只识别明确的原生错误或模式变化；固定文案不拼接诊断中的 URL、参数或凭据。 */
export function antigravityDiagnostic(value: string, source: 'run' | 'tool' = 'run'): DiagnosticEvent | undefined {
  const line = stripVTControlCharacters(value).trim();
  if (/^(?:info|debug|trace)\s*:|^I\d{4}\s/i.test(line)) return undefined;
  if (
    /(?:--mode\s+auto|auto\s+mode|mode\s+auto)/i.test(line) &&
    /not available|unavailable|not supported|unsupported/i.test(line)
  ) {
    const fallback = /continuing in the default mode|fall(?:ing)? back|fallback/i.test(line);
    const reason = /sandbox/i.test(line) ? '当前环境的终端沙箱不可用' : '当前账号或运行环境不支持此模式';
    if (!fallback)
      return { type: 'error', message: `Antigravity 的 auto 模式不可用：${reason}。请检查原生权限与沙箱支持。` };
    return {
      type: 'activity',
      id: 'agy-permission-mode',
      name: '权限模式已回退',
      status: 'completed',
      output: `Antigravity 的 auto 模式不可用：${reason}。原生 CLI 已回退到默认权限模式，需要确认的工具仍可能被拒绝。请检查原生权限与沙箱支持。`,
    };
  }
  if (
    /\b(?:unauthenticated|unauthorized|authentication required|authentication failed|login required|invalid api[ _-]?key|expired (?:credentials|token)|missing (?:credentials|api[ _-]?key))\b/i.test(
      line,
    )
  )
    return { type: 'error', message: 'Antigravity 认证失败或凭据无效，请检查原生登录状态与当前模型服务的凭据。' };
  const service = serviceDiagnostic(line, source);
  if (service) return service;
  if (/soft[-_\s]?den(?:ied|y)|\b(?:user denied permission|approval (?:was )?denied)\b/i.test(line))
    return { type: 'error', message: ANTIGRAVITY_PERMISSION_NOTICE };
  return undefined;
}
