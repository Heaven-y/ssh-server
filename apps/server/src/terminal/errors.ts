const failures = {
  invalid_request: [400, '终端消息格式不正确'],
  workspace_missing: [404, '工作区已不存在，请重新打开终端'],
  target_changed: [409, '终端目标或认证已变化，请从当前工作区重新打开'],
  binding_expired: [410, '终端绑定已过期，请重新新建连接'],
  cancelled: [409, '终端已关闭'],
  directory_unavailable: [409, '未进入工作区目录，请检查目录权限或 shell 配置'],
  startup_failed: [504, '终端启动超时或初始化失败，未开放输入'],
  ssh_unavailable: [503, 'SSH 连接不可用，请检查认证与主机密钥状态'],
  limit_reached: [429, '终端数量已达上限，请先关闭其他窗格'],
  input_overflow: [409, '终端输入拥塞，已结束本窗格；未继续执行剩余输入'],
  output_congested: [409, '终端输出拥塞，已结束本窗格，输出未完整显示'],
  consumer_timeout: [408, '终端输出消费超时，已结束本窗格'],
  connection_lost: [503, '终端连接已断开，请明确新建连接'],
  invalid_ack: [400, '终端输出消费确认不正确'],
} as const;
export type TerminalErrorCode = keyof typeof failures;
export class TerminalError extends Error {
  readonly status: number;
  constructor(readonly code: TerminalErrorCode) {
    const [status, message] = failures[code];
    super(message);
    this.status = status;
  }
}
export const terminalError = (error: unknown): TerminalError =>
  error instanceof TerminalError ? error : new TerminalError('ssh_unavailable');
