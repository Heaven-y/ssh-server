/** 接口错误；field 用于工作区字段校验，code 用于 SSH 错误分类 */
export class ApiError extends Error {
  readonly field?: string;
  readonly code?: string;
  readonly affectedPaths?: string[];

  constructor(
    readonly status: number,
    message: string,
    details: { field?: string; code?: string; affectedPaths?: string[] } = {},
  ) {
    super(message);
    this.field = details.field;
    this.code = details.code;
    this.affectedPaths = details.affectedPaths;
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (res.status === 401) throw new ApiError(401, '本机会话已失效，请刷新页面重新连接本机服务');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      field?: string;
      code?: string;
      affectedPaths?: string[];
    };
    throw new ApiError(res.status, body.message ?? `请求失败（${res.status}）`, body);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
