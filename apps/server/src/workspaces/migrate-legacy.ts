// 一次性数据迁移：把改名前的 %LOCALAPPDATA%\ssh-server 里的配置搬到 %LOCALAPPDATA%\AgentDeck。
// 只搬仍成立的文件；旧目录原样保留，不删除、不覆盖新目录已有内容。
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** 需要迁移的文件；sync/ 与 file-editors.json 属于已删除的功能，不迁移 */
const FILES = ['servers.json', 'workspaces.json'] as const;

export type MigrationReport = {
  source: string;
  /** 实际复制过去的文件名 */
  copied: string[];
  /** 源文件不存在而跳过的文件名 */
  skipped: string[];
  /** 新目录已有同名文件而跳过的文件名 */
  keptExisting: string[];
  /** 迁移过程中出现的错误说明；为空表示没有错误 */
  errors: string[];
};

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 迁移旧数据目录里的配置。
 * - 旧目录不存在：返回空报告，不做事。
 * - 新目录已有同名文件：不覆盖，记入 keptExisting。
 * - 单个文件失败：记入 errors，继续处理下一个。
 */
export async function migrateLegacyConfig(deps: { legacyDir: string; configDir: string }): Promise<MigrationReport> {
  const report: MigrationReport = {
    source: deps.legacyDir,
    copied: [],
    skipped: [],
    keptExisting: [],
    errors: [],
  };
  if (path.resolve(deps.legacyDir) === path.resolve(deps.configDir)) {
    report.errors.push('旧数据目录与新数据目录相同，未迁移');
    return report;
  }
  if (!(await exists(deps.legacyDir))) return report;

  let names: string[];
  try {
    names = await readdir(deps.legacyDir);
  } catch (error) {
    report.errors.push(`无法读取旧数据目录：${(error as Error).message}`);
    return report;
  }

  await mkdir(deps.configDir, { recursive: true });
  for (const name of FILES) {
    if (!names.includes(name)) {
      report.skipped.push(name);
      continue;
    }
    const source = path.join(deps.legacyDir, name);
    const target = path.join(deps.configDir, name);
    if (await exists(target)) {
      report.keptExisting.push(name);
      continue;
    }
    try {
      await copyFile(source, target);
      report.copied.push(name);
    } catch (error) {
      report.errors.push(`复制 ${name} 失败：${(error as Error).message}`);
    }
  }
  return report;
}
