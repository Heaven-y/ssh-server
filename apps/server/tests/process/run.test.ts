import { describe, expect, it } from 'vitest';
import { runProcess } from '../../src/sync/process';

describe('受限同步子进程', () => {
  it('stdin 与环境只交给子进程，不放到 argv', async () => {
    const result = await runProcess(
      process.execPath,
      [
        '-e',
        "process.stdin.on('data',b=>process.stdout.write(JSON.stringify({input:b.toString(),secret:process.env.TEST_SECRET,argv:process.argv.slice(1)})))",
      ],
      {
        input: 'fixture-secret',
        env: { TEST_SECRET: 'obscured-fixture' },
        timeoutMs: 2000,
        outputCap: 1000,
      },
    );
    expect(JSON.parse(result.stdout.toString())).toEqual({
      input: 'fixture-secret',
      secret: 'obscured-fixture',
      argv: [],
    });
    expect(result.exitCode).toBe(0);
  });
  it('输出超限停止子进程并返回安全错误', async () => {
    await expect(
      runProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(10000))"], {
        timeoutMs: 2000,
        outputCap: 100,
      }),
    ).rejects.toMatchObject({ code: 'output_limit' });
  });
  it('超时停止子进程，不留下等待任务', async () => {
    await expect(
      runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 60, outputCap: 100 }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
  it('找不到可执行文件给出明确错误', async () => {
    await expect(
      runProcess('missing-rclone-fixture.invalid', [], { timeoutMs: 100, outputCap: 100 }),
    ).rejects.toMatchObject({ code: 'executable_missing' });
  });
});
