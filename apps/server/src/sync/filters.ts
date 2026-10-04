// 与 rclone 过滤文件保持相同规则；任何决策路径都须先校验。
import type { SyncSettings } from '@ssh-server/shared';
import { SyncError } from './errors';

export function safeRelativePath(file: string): string {
  const parts = file.split('/');
  if (
    !file ||
    /[\\:\r\n\0<>"|?*]/.test(file) ||
    parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))
  )
    throw new SyncError('unsafe_path', '同步包含不安全或 Windows 无法表示的相对路径，已停止');
  if (parts.some((part) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw new SyncError('unsafe_path', '同步路径使用了系统保留文件名，已停止');
  return file;
}
export function excludedPath(file: string, settings: SyncSettings): boolean {
  if (file.split('/').some((part) => part.toLowerCase() === '.git')) return true;
  const extension = file.split('.').at(-1)?.toLowerCase();
  return file.includes('.') && settings.excludedExtensions.includes(extension ?? '');
}
export function eligibleFile(file: string, size: number, settings: SyncSettings): boolean {
  safeRelativePath(file);
  return size >= 0 && size <= settings.maxFileBytes && !excludedPath(file, settings);
}

/** Windows 的目录分量和文件名均不区分大小写；同时拒绝文件/目录占用冲突。 */
export function assertCompatiblePaths(files: Iterable<string>, directories: Iterable<string> = []): void {
  const entries = new Map<string, { spelling: string; file: boolean }>();
  function add(name: string, isFile: boolean) {
    const parts = safeRelativePath(name).split('/');
    for (let index = 0; index < parts.length; index++) {
      const spelling = parts.slice(0, index + 1).join('/');
      const key = spelling.toLowerCase();
      const file = isFile && index === parts.length - 1;
      const previous = entries.get(key);
      if (previous && (previous.spelling !== spelling || previous.file !== file))
        throw new SyncError('case_collision', '路径存在 Windows 无法区分的大小写或文件目录冲突，已停止同步');
      entries.set(key, { spelling, file });
    }
  }
  for (const directory of directories) add(directory, false);
  for (const file of files) add(file, true);
}
export function filterText(settings: SyncSettings): string {
  return [
    '- .git',
    '- **/.git',
    '- .git/**',
    '- **/.git/**',
    ...settings.excludedExtensions.map((extension) => `- *.${extension}`),
    '+ **',
    '',
  ].join('\n');
}
