// 文件内容、完整本机路径与底层系统异常不能进入 HTTP 错误。
const failures = {
  invalid_request: { status: 400, message: '文件请求格式不正确' },
  unsafe_path: { status: 400, message: '仅支持工作区内的普通目录与文件，路径不能越界或经过链接' },
  excluded: { status: 403, message: '该路径已被同步规则排除' },
  not_found: { status: 404, message: '文件或目录已不存在，请刷新文件列表' },
  workspace_missing: { status: 404, message: '工作区不存在' },
  too_large: { status: 413, message: '文件超过网页编辑上限或当前同步大小阈值' },
  invalid_text: { status: 415, message: '仅支持有效的 UTF-8 文本，不能编辑二进制文件' },
  revision_conflict: { status: 409, message: '文件已被其他操作修改，请重新读取后再保存' },
  io_error: { status: 500, message: '无法读写工作区文件，请检查文件及目录权限' },
} as const;

export class WorkspaceFileError extends Error {
  readonly status: number;

  constructor(readonly code: keyof typeof failures) {
    super(failures[code].message);
    this.name = 'WorkspaceFileError';
    this.status = failures[code].status;
  }
}

export function anonymousFileError(error: unknown): WorkspaceFileError {
  if (error instanceof WorkspaceFileError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return new WorkspaceFileError('not_found');
  if (code === 'ELOOP' || code === 'ENOTDIR') return new WorkspaceFileError('unsafe_path');
  return new WorkspaceFileError('io_error');
}

export async function fileOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw anonymousFileError(error);
  }
}
