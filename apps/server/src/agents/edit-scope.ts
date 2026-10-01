// 判断文件路径是否在本地文件夹内：用于自动允许 Agent 在工作区里编辑文件
import path from 'node:path';

const looksWindows = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');

/** filePath 可以是相对路径（按 dir 解析）；Windows 路径不区分大小写 */
export function isInsideDir(dir: string, filePath: string): boolean {
  const p = looksWindows(dir) ? path.win32 : path;
  const fold = (s: string) => (p === path.win32 ? s.toLowerCase() : s);
  const base = fold(p.resolve(dir));
  const target = fold(p.resolve(dir, filePath));
  const rel = p.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}
