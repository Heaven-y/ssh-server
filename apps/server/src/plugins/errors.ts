import { NativeConfigError } from '../settings/errors';

const failures = {
  invalid_request: { status: 400, message: '插件请求格式不正确' },
  invalid_manifest: { status: 400, message: '插件清单无效或不支持当前接口版本' },
  package_rejected: { status: 400, message: '安装包只能包含清单与静态资源，请移除源码、运行配置和凭据文件' },
  too_large: { status: 413, message: '插件文件、安装包或存储超过允许大小' },
  unsafe_path: { status: 409, message: '插件路径不安全或发生变化，未继续操作' },
  revision_conflict: { status: 409, message: '插件状态已变化，请刷新后重试' },
  already_installed: { status: 409, message: '该插件已安装；请先卸载旧版本' },
  plugin_missing: { status: 404, message: '插件不存在' },
  plugin_disabled: { status: 403, message: '插件已停用，请先启用' },
  permission_denied: { status: 403, message: '插件未声明此项权限' },
  builtin_plugin: { status: 409, message: '内置插件不能卸载或通过外部页面接口访问' },
  cleanup_failed: { status: 503, message: '插件资源清理失败，未完成停用或卸载，请重试' },
  registry_invalid: { status: 503, message: '插件状态文件无效，原文件已保留' },
  io_error: { status: 500, message: '无法访问插件文件，请检查目录和权限' },
} as const;

export class WorkbenchPluginError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof failures) {
    super(failures[code].message);
    this.name = 'WorkbenchPluginError';
    this.status = failures[code].status;
  }
}

export function pluginError(error: unknown): WorkbenchPluginError {
  if (error instanceof WorkbenchPluginError) return error;
  if (error instanceof NativeConfigError) {
    if (error.code === 'unsafe_path' || error.code === 'too_large' || error.code === 'revision_conflict')
      return new WorkbenchPluginError(error.code);
  }
  return new WorkbenchPluginError('io_error');
}
