import { SshConnectionError } from '../ssh/connection';

const failures = {
  cancelled: [499, '目录读取已取消'],
  invalid_request: [400, '服务器文件请求格式不正确'],
  invalid_path: [400, '请输入有效的服务器目录路径'],
  not_directory: [400, '该路径不是普通目录；链接不会自动进入其指向目录'],
  target_changed: [409, '工作区或 SSH 目标已变化，请关闭文件面板并重新打开'],
  session_expired: [410, '服务器浏览连接已结束，请重新连接文件视图'],
  cursor_expired: [410, '目录分页已过期，请刷新当前目录'],
  too_many_sessions: [429, '打开的服务器文件视图过多，请关闭不用的面板后重试'],
  workspace_missing: [404, '工作区不存在'],
  not_found: [404, '服务器目录已不存在，请返回上级或工作区目录'],
  permission_denied: [403, '当前 SSH 账号无权读取该目录'],
  connection_failed: [502, '无法读取服务器目录，请检查连接后重试'],
  timeout: [504, '服务器目录读取超时，请重新连接文件视图'],
} as const;

export class RemoteFilesError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof failures) {
    super(failures[code][1]);
    this.status = failures[code][0];
  }
}

export function remoteFilesError(error: unknown): { code: string; message: string; status: number } {
  if (error instanceof RemoteFilesError) return error;
  if (error instanceof SshConnectionError) return { ...error, message: error.message, status: 409 };
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === 2 || code === 'ENOENT') return new RemoteFilesError('not_found');
  if (code === 3 || code === 'EACCES') return new RemoteFilesError('permission_denied');
  if (code === 'sftp_timeout') return new RemoteFilesError('timeout');
  if (code === 'sftp_closed') return new RemoteFilesError('session_expired');
  return new RemoteFilesError('connection_failed');
}
