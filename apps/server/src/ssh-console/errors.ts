import { SshConnectionError } from '../ssh/connection';

const failures = {
  plugin_disabled: [403, 'SSH 控制台插件已停用'],
  invalid_request: [400, 'SSH 控制台请求格式不合法'],
  target_changed: [409, '服务器连接已变化，请重新连接'],
  terminal_missing: [404, '该服务器上没有这个终端，请重新读取终端列表'],
  terminal_limit: [409, '终端数量已达上限，请先关闭不再使用的终端'],
  terminal_exited: [409, '终端已经退出，请新建终端'],
  directory_unavailable: [502, '无法读取远端目录，请检查路径及权限'],
  file_unavailable: [502, '无法预览远端文件，只支持可读取的普通文件'],
  operation_failed: [502, '服务器操作未完成，请检查连接及远端工具'],
  cancelled: [409, '操作已取消或控制台已关闭'],
} as const;

export class SshConsoleError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof failures) {
    super(failures[code][1]);
    this.status = failures[code][0];
  }
}

export function consoleFailure(error: unknown) {
  if (error instanceof SshConsoleError) return error;
  if (error instanceof SshConnectionError) return { status: 409, code: error.code, message: error.message };
  return new SshConsoleError('operation_failed');
}
