// 固定错误文案不携带解析器片段、文件内容或系统异常中的秘密信息。
const errors = {
  invalid_agent: { status: 400, message: '仅支持 Claude 与 Codex 配置' },
  invalid_request: { status: 400, message: '配置请求格式不正确' },
  invalid_utf8: { status: 400, message: '配置必须使用有效的 UTF-8 编码' },
  invalid_json: { status: 400, message: 'Claude 配置必须是有效的 JSON 对象' },
  invalid_toml: { status: 400, message: 'Codex 配置必须是有效的 TOML' },
  too_large: { status: 413, message: '配置文件不能超过 256 KiB' },
  unsafe_path: { status: 409, message: '配置路径必须是普通目录与文件，不能使用符号链接' },
  revision_conflict: { status: 409, message: '配置已被其他操作修改，请重新读取后再保存' },
  io_error: { status: 500, message: '无法读写本机配置，请检查文件及目录权限' },
} as const;

export class NativeConfigError extends Error {
  readonly status: number;

  constructor(readonly code: keyof typeof errors) {
    super(errors[code].message);
    this.name = 'NativeConfigError';
    this.status = errors[code].status;
  }
}

export function anonymousConfigError(error: unknown): NativeConfigError {
  return error instanceof NativeConfigError ? error : new NativeConfigError('io_error');
}
