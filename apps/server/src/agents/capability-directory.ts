import { stat } from 'node:fs/promises';
import { SessionError } from '../chat/sessions';
import type { CapabilityProvider } from './capability-types';

export async function assertCapabilityDirectory(directory: string): Promise<void> {
  const usable = await stat(directory).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
  if (!usable) throw new SessionError(409, 'workspace_directory_unavailable', '工作区目录不可用，请重新选择文件夹。');
}

/** 目录失效不能伪装成 CLI 安装或账号故障。只在实际发现时检查，不影响缓存读取。 */
export function withCapabilityDirectory(provider: CapabilityProvider): CapabilityProvider {
  return async (directory, signal) => {
    signal?.throwIfAborted();
    await assertCapabilityDirectory(directory);
    signal?.throwIfAborted();
    return provider(directory, signal);
  };
}
