import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** 开发技能和会话过程记录不属于产品文档，意外跟踪时也不参与检查。 */
const LOCAL_DIRECTORIES = ['.agents/', '.claude/', '.superpowers/', '.pi/'];

/** 枚举当前工作树中的正式 Markdown，包含尚未暂存的新文件。 */
export function markdownFiles(root = process.cwd()): string[] {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'], {
    cwd: root,
    encoding: 'utf8',
  });
  // -z 避免 Git 对中文路径加引号/转义，也保留文件名中的空格与换行。
  const candidates = new Set(output.split('\0').filter(Boolean));
  return [...candidates]
    .filter((file) => !LOCAL_DIRECTORIES.some((directory) => file.startsWith(directory)))
    .filter((file) => existsSync(resolve(root, file)))
    .sort();
}
