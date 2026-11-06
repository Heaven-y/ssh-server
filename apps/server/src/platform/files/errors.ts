// 公共文件操作错误不携带路径或文件内容。
const errors = {
  invalid_utf8: { status: 400, message: '配置必须使用有效的 UTF-8 编码' },
  too_large: { status: 413, message: '配置文件不能超过 256 KiB' },
  unsafe_path: { status: 409, message: '配置路径必须是普通目录与文件，不能使用符号链接' },
  revision_conflict: { status: 409, message: '配置已被其他操作修改，请重新读取后再保存' },
  io_error: { status: 500, message: '无法读写本机配置，请检查文件及目录权限' },
} as const;
export class FileAccessError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof errors) {
    super(errors[code].message);
    this.name = 'FileAccessError';
    this.status = errors[code].status;
  }
}
