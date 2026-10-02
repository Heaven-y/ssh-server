// 独立的本机密文文件；名称按实际目标摘要生成，不进入工作区 JSON。
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CredentialStorageError, storageCancelled, storageFailure } from './credential-storage-error';
import { createWindowsProtector, type SecretProtector } from './windows-protection';

const RecordSchema = z.object({
  version: z.literal(1),
  protected: z
    .string()
    .min(1)
    .max(32_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
type Deps = { configDir: string; protector?: SecretProtector };
const digest = (text: string) => createHash('sha256').update(text).digest();
async function ordinaryFile(file: string): Promise<boolean> {
  const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw storageFailure();
  });
  if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32_768) throw storageFailure();
  return true;
}
export function createPasswordStore(deps: Deps) {
  const protector = deps.protector ?? createWindowsProtector();
  const directory = path.join(deps.configDir, 'credentials');
  const revisions = new Map<string, number>();
  const queues = new Map<string, Promise<unknown>>();
  const revision = (key: string) => revisions.get(key) ?? 0;
  const target = (identity: string) => {
    const key = digest(identity).toString('hex');
    return { key, file: path.join(directory, `${key}.json`), entropy: digest(`ssh-server:credential:${identity}`) };
  };
  async function ensureDirectory() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageFailure();
  }
  function transaction<T>(key: string, action: () => Promise<T>): Promise<T> {
    const run = (queues.get(key) ?? Promise.resolve()).then(action, action).catch((error: unknown) => {
      if (error instanceof CredentialStorageError) throw error;
      throw storageFailure();
    });
    queues.set(key, run);
    void run
      .finally(() => {
        if (queues.get(key) === run) queues.delete(key);
      })
      .catch(() => undefined);
    return run;
  }
  async function record(file: string): Promise<Buffer | undefined> {
    if (!(await ordinaryFile(file))) return undefined;
    const parsed = RecordSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    const data = Buffer.from(parsed.protected, 'base64');
    if (data.toString('base64') !== parsed.protected) throw storageFailure();
    return data;
  }
  return {
    available: protector.available,
    has(identity: string) {
      const { key, file } = target(identity);
      return transaction(key, async () => (await record(file)) !== undefined);
    },
    load(identity: string) {
      const { key, file, entropy } = target(identity);
      const expected = revision(key);
      return transaction(key, async () => {
        const data = await record(file);
        if (!data) return undefined;
        const plaintext = await protector.unprotect(data, entropy);
        try {
          if (expected !== revision(key)) throw storageCancelled();
          const password = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
          if (!password.length || password.length > 4096 || /[\r\n\0]/.test(password)) throw storageFailure();
          return password;
        } finally {
          plaintext.fill(0);
        }
      });
    },
    save(identity: string, password: string, stillCurrent: () => boolean = () => true) {
      const { key, file, entropy } = target(identity);
      const expected = revision(key) + 1;
      revisions.set(key, expected);
      const assertCurrent = () => {
        if (expected !== revision(key) || !stillCurrent()) throw storageCancelled();
      };
      return transaction(key, async () => {
        await ensureDirectory();
        assertCurrent();
        if (!password.length || password.length > 4096 || /[\r\n\0]/.test(password)) throw storageFailure();
        const plaintext = Buffer.from(password, 'utf8');
        let protectedData: Buffer;
        try {
          protectedData = await protector.protect(plaintext, entropy);
        } finally {
          plaintext.fill(0);
        }
        assertCurrent();
        await ordinaryFile(file);
        const temporary = `${file}.tmp-${randomUUID()}`;
        try {
          await writeFile(
            temporary,
            JSON.stringify({ version: 1, protected: protectedData.toString('base64') }) + '\n',
            { flag: 'wx', mode: 0o600 },
          );
          assertCurrent();
          await rename(temporary, file);
        } finally {
          await rm(temporary, { force: true });
        }
      });
    },
    forget(identity: string) {
      const { key, file } = target(identity);
      revisions.set(key, revision(key) + 1);
      return transaction(key, async () => {
        await rm(file, { force: true });
      });
    },
  };
}
export type PasswordStore = ReturnType<typeof createPasswordStore>;
