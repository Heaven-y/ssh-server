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
