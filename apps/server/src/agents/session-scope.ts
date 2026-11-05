import { realpath } from 'node:fs/promises';
import path from 'node:path';

const normalized = (value: string) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/** 会话必须属于同一个本地目录，不能通过 resume 的 cwd 覆盖绕过检查。 */
export async function sameSessionDirectory(left: string, right: string): Promise<boolean> {
  if (!path.isAbsolute(left) || !path.isAbsolute(right)) return false;
  if (normalized(left) === normalized(right)) return true;
  try {
    const [a, b] = await Promise.all([realpath(left), realpath(right)]);
    return normalized(a) === normalized(b);
  } catch {
    return false;
  }
}

/** 项目可包含原生子目录；返回时仍使用原生 cwd，不能把续聊目录改成项目根。 */
export function sessionDirectoryWithin(directory: string, project: string): boolean {
  if (!path.isAbsolute(directory) || !path.isAbsolute(project)) return false;
  const relative = path.relative(normalized(project), normalized(directory));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
