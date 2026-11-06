// 同步域已删除；这里只保留远端条目「是否落在同步范围」的判定，供 RemoteFileEntry.scope 展示。
// 判定参数只剩 shared 的 RemoteFileFilter 默认值；文件浏览重做时再决定是否下线该标记。
import type { RemoteFileFilter } from '@agentdeck/shared/ssh';

/** 与 rclone 过滤文件保持相同规则；任何决策路径都须先校验。 */
export function safeRelativePath(file: string): string {
  const parts = file.split('/');
  if (
    !file ||
    /[\\:\r\n\0<>"|?*]/.test(file) ||
    parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))
  )
    throw new Error('包含不安全或 Windows 无法表示的相对路径');
  if (parts.some((part) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw new Error('路径使用了系统保留文件名');
  return file;
}

export function excludedPath(file: string, settings: RemoteFileFilter): boolean {
  if (file.split('/').some((part) => part.toLowerCase() === '.git')) return true;
  const extension = file.split('.').at(-1)?.toLowerCase();
  return file.includes('.') && settings.excludedExtensions.includes(extension ?? '');
}

export function eligibleFile(file: string, size: number, settings: RemoteFileFilter): boolean {
  safeRelativePath(file);
  return size >= 0 && size <= settings.maxFileBytes && !excludedPath(file, settings);
}
