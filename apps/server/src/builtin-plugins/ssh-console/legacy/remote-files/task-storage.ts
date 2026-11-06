import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { RemoteFilesError } from './errors';
import { TaskRecordSchema, type TaskRecord } from './task-record';

/** 完整校验后才交给恢复流程，任意未知记录都不能被当成无任务。 */
export async function loadTaskRecords(dir: string, onCorrupt?: (name: string) => void): Promise<TaskRecord[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new RemoteFilesError('task_storage_error');
  }
  const records: TaskRecord[] = [];
  for (const name of names) {
    // 原子替换前遗留的临时文件不是已提交记录，也不主动删除它们。
    if (/^[a-f0-9-]{36}\.json\.tmp-[a-f0-9-]{36}$/.test(name)) continue;
    try {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw new Error();
      const record = TaskRecordSchema.parse(JSON.parse(await readFile(path.join(dir, name), 'utf8')));
      if (record.task.id + '.json' !== name) throw new Error();
      records.push(record);
    } catch {
      onCorrupt?.(/^[a-f0-9-]{36}\.json$/.test(name) ? name : 'unknown-record');
      throw new RemoteFilesError('task_storage_error');
    }
  }
  return records;
}
