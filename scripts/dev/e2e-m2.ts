// 真实 SFTP/SSH 验收：仅使用显式提供的空测试根目录，清理自己的随机子目录。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SyncSettingsSchema, type Workspace } from '../../packages/shared/src/index';
import { createSshPool } from '../../apps/server/src/ssh/pool';
import { buildRemoteCommand, sq as quotePosix } from '../../apps/server/src/ssh/remote-command';
import { localInventory } from '../../apps/server/src/sync/inventory';
import { createSyncManager } from '../../apps/server/src/sync/manager';
import { runProcess } from '../../apps/server/src/sync/process';
import { createRcloneDriver } from '../../apps/server/src/sync/rclone';

const { values } = parseArgs({
  options: {
    host: { type: 'string' },
    'remote-dir': { type: 'string' },
    'local-dir': { type: 'string' },
    report: { type: 'string' },
    help: { type: 'boolean' },
  },
});
const steps: Array<{ name: string; elapsedMs: number }> = [];
const diagnostics: Array<{ operation?: string; stderr: string }> = [];
let stage = '参数';
function required(name: 'host' | 'remote-dir' | 'local-dir'): string {
  const value = values[name];
  if (!value) throw new Error(`缺少 --${name} 参数`);
  return value;
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const ws: Workspace = {
    id: randomUUID(),
    name: '同步验收',
    sshHost: required('host'),
    remoteDir: required('remote-dir'),
    localDir: required('local-dir'),
  };
  const configDir = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? os.tmpdir(), 'ssh-server-m2-'));
  const prefix = `ssh-server-e2e-${randomUUID()}`;
  const pool = createSshPool();
  const driver = createRcloneDriver({
    configDir,
    pool,
    run: async (exe, args, options) => {
      const result = await runProcess(exe, args, options);
      if (result.exitCode !== 0) diagnostics.push({ operation: args[0], stderr: result.stderr.toString('utf8') });
      return result;
    },
  });
  const manager = createSyncManager({ configDir, driver });
  const local = (file: string) => path.join(ws.localDir, prefix, file);
  const remoteFile = (file: string) => `${prefix}/${file}`;
  const remote = async (command: string) => {
    const result = await pool.exec(ws.sshHost, buildRemoteCommand(ws.remoteDir, command, 60), {
      localTimeoutMs: 90_000,
      outputCap: 20_000,
    });
    assert.equal(result.exitCode, 0, '远端验收命令失败');
    assert.equal(result.timedOut, false);
    return result;
  };
  const python = (code: string) => remote(`python3 -c ${quotePosix(code)}`);
  const syncReady = async () => {
    const status = await manager.sync(ws);
    assert.equal(status.phase, 'ready', status.message);
  };
  return { ws, configDir, prefix, pool, manager, local, remoteFile, remote, python, syncReady };
}
async function step(name: string, action: () => Promise<void>) {
  stage = name;
  const start = performance.now();
  await action();
  steps.push({ name, elapsedMs: Math.round(performance.now() - start) });
  console.log(`PASS：${name}`);
}
async function boundaries(f: Fixture) {
  assert.equal((await readdir(f.ws.localDir)).length, 0, '本地测试根目录必须为空');
  await f.python('from pathlib import Path; assert not any(Path(".").iterdir()), "remote test root must be empty"');
  await f.syncReady();
  await f.syncReady();
  await mkdir(path.dirname(f.local('analysis.py')), { recursive: true });
}
function source(numbers: number[]) {
  return `import json\nfrom pathlib import Path\nvalues = ${JSON.stringify(numbers)}\nresult = {"count": len(values), "sum": sum(values)}\nPath(__file__).with_name("result.json").write_text(json.dumps(result), encoding="utf-8")\nprint("analysis complete")\n`;
}
async function workflow(f: Fixture) {
  await writeFile(f.local('analysis.py'), source([1, 2, 3]), 'utf8');
  await f.syncReady();
  await writeFile(f.local('analysis.py'), source([1, 2, 3, 4]), 'utf8');
  await f.syncReady();
  const result = await f.manager.execute(f.ws, () => f.remote(`python3 ${quotePosix(f.remoteFile('analysis.py'))}`));
  assert.equal(result.sync.phase, 'ready');
  assert.match(result.stdout, /analysis complete/);
  assert.deepEqual(JSON.parse(await readFile(f.local('result.json'), 'utf8')), { count: 4, sum: 10 });
}
async function filters(f: Fixture) {
  const settings = SyncSettingsSchema.parse({});
  await mkdir(f.local('.git'));
  await writeFile(f.local('.git/private-marker'), 'excluded', 'utf8');
  await mkdir(f.local('worktree'));
  await writeFile(f.local('worktree/.git'), 'gitdir: local-pointer\n', 'utf8');
  await writeFile(f.local('weights.pth'), 'excluded', 'utf8');
  await writeFile(f.local('large.bin'), Buffer.alloc(settings.maxFileBytes + 1));
  await f.python(
    `from pathlib import Path; base=Path(${JSON.stringify(f.prefix)}); (base/"remote-weight.pt").write_text("excluded"); (base/"remote-large.bin").write_bytes(bytes(${settings.maxFileBytes + 1})); (base/"远端小结果.txt").write_text("small remote result", encoding="utf-8"); (base/"worktree").mkdir(); (base/"worktree/.git").write_text("gitdir: remote-pointer\\n", encoding="utf-8")`,
  );
  await f.syncReady();
  await f.python(
    `from pathlib import Path; base=Path(${JSON.stringify(f.prefix)}); assert not (base/".git").exists(); assert not (base/"weights.pth").exists(); assert not (base/"large.bin").exists(); assert (base/"worktree/.git").read_text(encoding="utf-8") == "gitdir: remote-pointer\\n"`,
  );
  assert.equal(await readFile(f.local('远端小结果.txt'), 'utf8'), 'small remote result');
  assert.equal(await readFile(f.local('worktree/.git'), 'utf8'), 'gitdir: local-pointer\n');
  const files = await readdir(path.dirname(f.local('analysis.py')));
  assert.equal(files.includes('remote-weight.pt'), false);
  assert.equal(files.includes('remote-large.bin'), false);
}
async function deletion(f: Fixture) {
  await rm(f.local('result.json'));
  assert.equal((await f.manager.sync(f.ws)).reason, 'deletions');
  await assert.rejects(
    f.manager.execute(f.ws, () => Promise.reject(new Error('不应执行'))),
    { code: 'sync_blocked' },
  );
  assert.equal((await f.manager.resolveDeletions(f.ws, 'reject')).phase, 'ready');
  assert.deepEqual(JSON.parse(await readFile(f.local('result.json'), 'utf8')), { count: 4, sum: 10 });
  await rm(f.local('result.json'));
  assert.equal((await f.manager.sync(f.ws)).reason, 'deletions');
  assert.equal((await f.manager.resolveDeletions(f.ws, 'confirm')).phase, 'ready');
  await f.python(`from pathlib import Path; assert not Path(${JSON.stringify(f.remoteFile('result.json'))}).exists()`);
}
async function conflict(f: Fixture) {
  await writeFile(f.local('conflict.txt'), 'baseline', 'utf8');
  await f.syncReady();
  await writeFile(f.local('conflict.txt'), 'local-v2', 'utf8');
  await f.python(
    `from pathlib import Path; Path(${JSON.stringify(f.remoteFile('conflict.txt'))}).write_text("remotev2", encoding="utf-8")`,
  );
  const status = await f.manager.sync(f.ws);
  const listing = await localInventory(f.ws.localDir, SyncSettingsSchema.parse({}));
  assert.equal(status.phase, 'conflicts', JSON.stringify({ status, files: listing.included.map((file) => file.path) }));
  const copies = status.conflicts.find((item) => item.path === f.remoteFile('conflict.txt'));
  assert.ok(copies);
  assert.equal(await readFile(path.join(f.ws.localDir, copies.localCopy), 'utf8'), 'local-v2');
  assert.equal(await readFile(path.join(f.ws.localDir, copies.remoteCopy), 'utf8'), 'remotev2');
  await writeFile(f.local('conflict.txt'), 'chosen result', 'utf8');
  assert.equal((await f.manager.acknowledgeConflicts(f.ws)).phase, 'ready');
}
async function finalDeletion(f: Fixture) {
  const inventory = await localInventory(f.ws.localDir, SyncSettingsSchema.parse({}));
  for (const file of inventory.included) await rm(path.join(f.ws.localDir, file.path));
  assert.equal((await f.manager.sync(f.ws)).reason, 'deletions');
  assert.equal((await f.manager.resolveDeletions(f.ws, 'confirm')).phase, 'ready');
  await f.syncReady();
}
async function cleanup(f: Fixture) {
  f.manager.dispose();
  try {
    await f.python(
      `import shutil; from pathlib import Path; p=Path(${JSON.stringify(f.prefix)}); assert p.name.startswith("ssh-server-e2e-"); assert not p.is_symlink(); shutil.rmtree(p) if p.exists() else None`,
    );
    await rm(path.join(f.ws.localDir, f.prefix), { recursive: true, force: true });
  } finally {
    f.pool.dispose();
    await rm(f.configDir, { recursive: true, force: true });
  }
}
async function run() {
  if (values.help) {
    console.log(
      '用法：node --import tsx scripts/dev/e2e-m2.ts --host my-server --remote-dir ~/projects/test --local-dir <空测试目录> [--report <私有报告路径>]',
    );
    return;
  }
  const f = await fixture();
  try {
    await step('专用空目录边界与连续空基线', () => boundaries(f));
    await step('首个文件、单文件更新、远端 Python 与结果拉回', () => workflow(f));
    await step('中文小文件及 Git、权重、大文件过滤', () => filters(f));
    await step('删除暂停执行、拒绝恢复与确认传播', () => deletion(f));
    await step('双端同大小修改保留冲突版本与恢复', () => conflict(f));
    await step('删除最后文件与恢复空基线', () => finalDeletion(f));
  } finally {
    await cleanup(f);
  }
}
run()
  .then(async () => {
    if (values.report) await writeFile(values.report, JSON.stringify({ passed: true, steps }, null, 2), 'utf8');
  })
  .catch(async (error: unknown) => {
    if (values.report)
      await writeFile(
        values.report,
        JSON.stringify({ passed: false, stage, steps, diagnostics, error: (error as Error).stack }, null, 2),
        'utf8',
      );
    console.error(`FAIL：${stage}；诊断仅写入显式指定的私有报告。`);
    process.exitCode = 1;
  });
