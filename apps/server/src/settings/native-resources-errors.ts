import { NativeConfigError } from './errors';

const errors = {
  invalid_agent: { status: 400, message: '不支持的 CLI 类型' },
  invalid_request: { status: 400, message: '原生资源请求格式不正确' },
  resource_missing: { status: 404, message: '原生资源已不存在或不属于当前目录，请刷新列表' },
  project_missing: { status: 404, message: '项目不存在，请重新选择项目' },
  invalid_utf8: { status: 400, message: '原生文件必须使用有效的 UTF-8 编码' },
  invalid_json: { status: 400, message: '内容必须是有效的 JSON 对象' },
  invalid_toml: { status: 400, message: '内容必须是有效的 TOML' },
  too_large: { status: 413, message: '原生文件不能超过 256 KiB' },
  unsafe_path: { status: 409, message: '资源路径必须是普通目录与文件，不能使用符号链接' },
  revision_conflict: { status: 409, message: '原生文件已被其他操作修改，请重新读取后再保存' },
  io_error: { status: 500, message: '无法读写原生文件，请检查目录及文件权限' },
} as const;

export class NativeResourceError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof errors) {
    super(errors[code].message);
    this.name = 'NativeResourceError';
    this.status = errors[code].status;
  }
}

export function resourceError(error: unknown): NativeResourceError {
  if (error instanceof NativeResourceError) return error;
  if (error instanceof NativeConfigError) return new NativeResourceError(error.code);
  return new NativeResourceError('io_error');
}
