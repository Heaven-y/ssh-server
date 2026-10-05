const failures = {
  invalid_request: { status: 400, message: '版本请求格式不正确' },
  invalid_commit: { status: 400, message: '请选择本地仓库中有效的提交' },
  unsafe_path: { status: 409, message: '版本操作遇到不安全路径、链接或非普通文件' },
  workspace_missing: { status: 404, message: '工作区不存在' },
  not_initialized: { status: 409, message: '请先初始化本地版本记录' },
  repository_busy: { status: 409, message: '仓库正被其他 Git 操作使用，或有未完成的合并、变基，请先处理后重试' },
  stale_revision: { status: 409, message: '文件、暂存区或当前提交已变化，请刷新后重新确认' },
  staged_changes: { status: 409, message: '该文件有独立暂存改动，请先在本机处理暂存区后再放弃' },
  hierarchy_conflict: {
    status: 409,
    message: '文件与目录替换会影响工作区外或已排除的暂存内容，请先在本机处理路径冲突',
  },
  git_missing: { status: 503, message: '无法启动本机 Git，请安装 Git 并确认后端能够访问' },
  git_version: { status: 503, message: '版本记录需要 Git 2.43 或更新版本，请升级本机 Git 后重试' },
  identity_missing: { status: 409, message: 'Git 作者身份未配置，请在本机为该仓库设置 user.name 与 user.email 后重试' },
  limit_exceeded: { status: 413, message: '版本操作范围或输出超过安全上限，请缩小工作区或按文件查看' },
  timeout: { status: 504, message: '本地 Git 操作超时，请检查仓库状态后重试' },
  partial_save: { status: 500, message: '提交与暂存区更新未能全部完成，请在本机检查 Git 状态后继续' },
  partial_restore: { status: 500, message: '恢复未能全部完成或回滚，请检查列出的已处理文件后再继续' },
  git_error: { status: 500, message: '本地 Git 操作失败，请检查仓库状态与访问权限' },
} as const;

export class VersionError extends Error {
  readonly status: number;
  constructor(
    readonly code: keyof typeof failures,
    readonly affectedPaths?: string[],
  ) {
    super(failures[code].message);
    this.name = 'VersionError';
    this.status = failures[code].status;
  }
}

export async function versionOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof VersionError) throw error;
    throw new VersionError('git_error');
  }
}
