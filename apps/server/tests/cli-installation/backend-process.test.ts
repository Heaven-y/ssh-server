import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { runInstallationProcess } from '../../src/cli-installation/installation-process';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

it.runIf(process.platform === 'win32')(
  '取消安装时连同安装器启动的子进程一起退出',
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentdeck-install-process-'));
    const marker = path.join(dir, 'child.pid');
    let childPid = 0;
    const abort = new AbortController();
    const script = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e','require("node:fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)',process.argv[1]],{stdio:'ignore',detached:true});setInterval(()=>{},1000);`;
    const operation = runInstallationProcess(process.execPath, ['-e', script, marker], {
      timeoutMs: 15_000,
      outputCap: 4096,
      signal: abort.signal,
    });
    const failure = operation.catch((error: unknown) => error);
    try {
      for (let attempt = 0; attempt < 100 && !childPid; attempt++) {
        childPid = Number(await readFile(marker, 'utf8').catch(() => ''));
        if (!childPid) await delay(50);
      }
      expect(childPid).toBeGreaterThan(0);
      expect(alive(childPid)).toBe(true);
      abort.abort();
      expect(await failure).toMatchObject({ code: 'aborted' });
      expect(alive(childPid)).toBe(false);
    } finally {
      abort.abort();
      await failure;
      if (childPid && alive(childPid)) process.kill(childPid, 'SIGKILL');
      await rm(dir, { recursive: true, force: true });
    }
  },
  20_000,
);

it('安装程序输出和运行时间都受限，错误不包含其输出', async () => {
  await expect(
    runInstallationProcess(process.execPath, ['-e', 'console.log("private".repeat(10000));setInterval(()=>{},1000)'], {
      timeoutMs: 5000,
      outputCap: 100,
    }),
  ).rejects.toMatchObject({ code: 'output_limit' });
  await expect(
    runInstallationProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100, outputCap: 100 }),
  ).rejects.toMatchObject({ code: 'timeout' });
});
