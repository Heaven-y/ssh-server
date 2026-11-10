import { SessionError } from '../agents/errors';
import { BackendError } from './index';

const ERRORS = {
  invalid_request: [400, 'CLI 安装请求格式不正确'],
  too_large: [413, 'CLI 安装请求内容过大'],
  agent_busy: [409, '请结束该 CLI 会话后重试'],
  installation_busy: [409, '已有安装或更新任务，请等待完成后再试'],
  revision_conflict: [409, '本机安装状态已变化，请重新检查后重试'],
  check_required: [409, '请先重新检查最新版本，再安装或更新'],
  unsupported: [409, '当前安装来源不支持此操作，请使用官方安装指南'],
  service_closed: [503, '服务正在关闭，请稍后重试'],
  check_failed: [502, '检查最新版本失败，请稍后重试'],
  install_failed: [500, 'CLI 安装或更新失败，请检查本机状态后重试'],
  verification_failed: [500, '安装后验证未通过，请检查 CLI 版本与安装来源'],
  incompatible: [500, 'CLI 已更改，但工作台兼容性检查未通过，请使用官方指南检查安装'],
  internal_error: [500, '无法读取 CLI 安装状态，请稍后重试'],
} as const;
type FailureCode = keyof typeof ERRORS;

export class CliInstallationError extends Error {
  readonly status: number;

  constructor(
    readonly code: FailureCode,
    safeMessage?: string,
  ) {
    super(safeMessage ?? ERRORS[code][1]);
    this.status = ERRORS[code][0];
  }
}

/** 只透出本模块与后端明确生成的安全消息，不使用进程或文件系统异常正文。 */
export function installationFailure(error: unknown, fallback: FailureCode = 'internal_error'): CliInstallationError {
  if (error instanceof CliInstallationError) return error;
  if (error instanceof SessionError && error.code === 'agent_busy') return new CliInstallationError('agent_busy');
  if (error instanceof BackendError) return new CliInstallationError(fallback, error.message);
  return new CliInstallationError(fallback);
}
