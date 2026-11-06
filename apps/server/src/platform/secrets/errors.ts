// 保存凭据的错误只包含分类与固定提示，不携带系统输出或秘密。
export type CredentialStorageCode =
  'password_storage_unavailable' | 'credential_storage_failed' | 'credential_operation_cancelled';
export class CredentialStorageError extends Error {
  override name = 'CredentialStorageError';
  constructor(
    public readonly code: CredentialStorageCode,
    message: string,
  ) {
    super(message);
  }
}
export const storageFailure = () =>
  new CredentialStorageError(
    'credential_storage_failed',
    '本机系统加密或凭据文件操作失败，请检查当前用户与配置目录权限',
  );
export const storageCancelled = () =>
  new CredentialStorageError('credential_operation_cancelled', '凭据操作已失效，请重新连接');
