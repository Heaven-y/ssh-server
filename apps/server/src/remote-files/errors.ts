import { SshConnectionError } from '../ssh/connection';
import { SyncError } from '../sync/errors';

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
  operation_unavailable: [409, '服务器缺少所需文件操作能力；目录浏览与下载仍可使用'],
  unsupported_file: [400, '该对象不是普通文件、目录或符号链接，不能直接操作'],
  destination_exists: [409, '目标已存在；不会覆盖或合并，请选择另一目标'],
  invalid_destination: [400, '目标位置不适用于该操作，不能复制或移动到源目录内部'],
  protected_root: [409, '不能移动、删除或覆盖已配置的工作区根及其祖先目录'],
  linked_parent: [409, '父路径包含符号链接或不是目录，请使用实际目录路径'],
  stale_preflight: [409, '文件、目标或配置已变化，请重新预检后确认'],
  preflight_expired: [410, '操作预检已过期，请重新选择源和目标'],
  scan_incomplete: [409, '目录扫描未完整完成，不能确认操作影响；请缩小操作范围'],
  verification_failed: [409, '服务器内复制核对失败，源文件已保留；请核对部分目标'],
  operation_failed: [502, '服务器文件操作未完整完成，请核对源与目标的实际结果'],
  sync_pending: [409, '相关同步尚未就绪，请处理冲突、待确认事项或恢复后重试'],
  invalid_sync_path: [409, '目标中包含本地镜像无法表示的同步文件名，请改名或移到同步范围外'],
  sync_case_collision: [409, '目标同步文件存在本地无法区分的大小写重名，请改名后重试'],
  editor_dirty: [409, '相关文件有未保存编辑，请先保存或明确放弃修改，再重新预检'],
  editor_locked: [409, '相关工作区正在协调服务器文件操作，请稍后编辑'],
  editor_unavailable: [409, '相关编辑器状态尚未确认，请重连原页面，或确认放弃已断开页面的缓冲登记'],
  task_missing: [404, '文件任务不存在或不属于当前工作区'],
  too_many_tasks: [429, '待处理文件任务过多，请等待已有任务完成'],
} as const;

export class RemoteFilesError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof failures) {
    super(failures[code][1]);
    this.status = failures[code][0];
  }
}

export function fileOperationError(code: string | undefined): RemoteFilesError {
  return new RemoteFilesError(
    code && Object.hasOwn(failures, code) ? (code as keyof typeof failures) : 'operation_failed',
  );
}

function typedError(error: unknown) {
  if (error instanceof RemoteFilesError) return error;
  if (error instanceof SyncError)
    return {
      code: error.code === 'case_collision' ? 'sync_case_collision' : 'sync_pending',
      message: error.message,
      status: 409,
    };
  if (error instanceof SshConnectionError) return { ...error, message: error.message, status: 409 };
  return undefined;
}
export function remoteFilesError(error: unknown): { code: string; message: string; status: number } {
  const known = typedError(error);
  if (known) return known;
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === 2 || code === 'ENOENT') return new RemoteFilesError('not_found');
  if (code === 3 || code === 'EACCES') return new RemoteFilesError('permission_denied');
  if (code === 'sftp_timeout') return new RemoteFilesError('timeout');
  if (code === 'sftp_closed') return new RemoteFilesError('session_expired');
  return new RemoteFilesError('connection_failed');
}
