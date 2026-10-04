import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const Records = z.array(z.object({ id: z.string().uuid(), workspaceId: z.string().min(1) }).strict()).max(64);
export type EditorRecord = z.infer<typeof Records>[number];

/** 只持久化登记的存在性；重启后均视为状态未知，必须重连或明确放弃。 */
export function createEditorRecords(configDir: string) {
  const file = path.join(configDir, 'file-editors.json');
  let writes: Promise<unknown> = Promise.resolve();
  return {
    async read(): Promise<EditorRecord[]> {
      const source = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '[]';
        throw error;
      });
      if (Buffer.byteLength(source) > 32_768) throw new Error('编辑登记记录过大，已暂停文件操作');
      return Records.parse(JSON.parse(source));
    },
    save(records: EditorRecord[]) {
      const contents = JSON.stringify(records) + '\n';
      const operation = async () => {
        await mkdir(configDir, { recursive: true, mode: 0o700 });
        const temporary = file + '.tmp-' + randomUUID();
        await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, file);
      };
      const run = writes.then(operation, operation);
      writes = run.catch(() => undefined);
      return run;
    },
  };
}
