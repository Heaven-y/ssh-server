import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, link, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HelperInput, RemoteActionPlan } from '../../src/remote-files/executor';
import { ResultCheckSchema } from '../../src/remote-files/task-record';

// 处理器的 fd / renameat2 保证依赖 Linux；Windows 不用替身冒充该保证。
describe.skipIf(process.platform !== 'linux')('固定 Linux 文件处理器', () => {
  const helper = fileURLToPath(new URL('../../src/remote-files/remote-helper.py', import.meta.url));
  let temporary: string;
  let root: string;
  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'remote-helper-'));
    root = path.join(temporary, 'workspace');
    await mkdir(root);
  });
  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  async function run(input: HelperInput, budget?: number) {
    const source = await readFile(helper, 'utf8');
    const code = budget ? source.replace('MAX_ENTRIES = 50000', `MAX_ENTRIES = ${budget}`) : source;
    const payload = Buffer.from(JSON.stringify(input)).toString('base64');
    let output: string;
    try {
      output = execFileSync('python3', ['-c', code, payload], { encoding: 'utf8', timeout: 10_000 });
    } catch (error) {
      output = (error as { stdout: string }).stdout;
    }
    const events = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: string; code?: string; result?: unknown });
    return { events, last: events[events.length - 1]! };
  }
  async function planned(input: Omit<HelperInput, 'action' | 'roots'>, roots = [root]) {
    const request = { ...input, action: 'plan' as const, roots };
    const outcome = await run(request);
    expect(outcome.last.event).toBe('result');
    return { ...request, action: 'execute' as const, expected: outcome.last.result as RemoteActionPlan };
  }

  it('新建不覆盖；保护实际工作区根、配置根链接及祖先，执行时拒绝链接改指向', async () => {
    const folder = path.join(temporary, 'folder');
    const create = await planned({ kind: 'mkdir', destination: folder });
    expect((await run(create)).last.event).toBe('result');
    expect((await run({ ...create, action: 'plan' })).last.code).toBe('destination_exists');
    const configured = path.join(temporary, 'workspace-link');
    await symlink(root, configured);
    for (const source of [configured, temporary, root]) {
      expect((await run({ action: 'plan', kind: 'delete', roots: [configured], source })).last.code).toBe(
        'protected_root',
      );
    }
    const remove = await planned({ kind: 'delete', source: folder }, [configured]);
    await rm(configured);
    await symlink(folder, configured);
    expect((await run(remove)).last.code).toBe('protected_root');
  });

  it('目录复制核对正文及链接本身；删除硬链接目录不因自身 ctime 改变中断', async () => {
    const source = path.join(temporary, 'source');
    const target = path.join(temporary, 'target');
    const external = path.join(temporary, 'outside.txt');
    await mkdir(source);
    await writeFile(external, '不可跟随的正文');
    const first = path.join(source, '一.py');
    await writeFile(first, '正文\n');
    await link(first, path.join(source, 'hard.py'));
    await symlink(external, path.join(source, 'link'));
    const copy = await planned({ kind: 'copy', source, destination: target });
    expect((await run(copy)).last.event).toBe('result');
    expect(await readFile(path.join(target, '一.py'), 'utf8')).toBe('正文\n');
    const remove = await planned({ kind: 'delete', source });
    expect((await run(remove)).last.event).toBe('result');
    await expect(readFile(first)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(external, 'utf8')).toBe('不可跟随的正文');
  });

  it('陈旧源与迟到同名目标均拒绝操作，带链接的父路径不能绕过保护', async () => {
    const source = path.join(temporary, 'source.py');
    const target = path.join(temporary, 'target.py');
    await writeFile(source, 'before');
    const move = await planned({ kind: 'move', source, destination: target });
    await writeFile(target, '保留同名目标');
    expect((await run(move)).last.code).toBe('destination_exists');
    await rm(target);
    await writeFile(source, 'changed');
    expect((await run(move)).last.code).toBe('stale_preflight');
    const linkedParent = path.join(temporary, 'parent-link');
    await symlink(temporary, linkedParent);
    expect(
      (
        await run({
          action: 'plan',
          kind: 'copy',
          source: path.join(linkedParent, 'source.py'),
          destination: target,
          roots: [root],
        })
      ).last.code,
    ).toBe('linked_parent');
    expect(await readFile(source, 'utf8')).toBe('changed');
  });

  it('预检和内容核对共享条目预算，超限不返回完整结果', async () => {
    const source = path.join(temporary, 'large');
    await mkdir(source);
    await Promise.all(['a', 'b', 'c'].map((name) => writeFile(path.join(source, name), name)));
    expect((await run({ action: 'plan', kind: 'delete', source, roots: [root] }, 3)).last.code).toBe('scan_incomplete');
    expect(
      (await run({ action: 'check', kind: 'delete', source, roots: [root], verifyContent: true }, 3)).last.code,
    ).toBe('scan_incomplete');
  });

  it('同文件系统移动不覆盖并可核对源消失及目标身份', async () => {
    const source = path.join(temporary, 'source.py');
    const destination = path.join(temporary, 'destination.py');
    await writeFile(source, 'server-only');
    const move = await planned({ kind: 'move', source, destination });
    expect((await run(move)).last.event).toBe('result');
    const checked = await run({ action: 'check', kind: 'move', source, destination, roots: [root] });
    const result = ResultCheckSchema.parse(checked.last.result);
    expect(result.source?.exists).toBe(false);
    expect(result.destination?.facts?.slice(0, 5)).toEqual(move.expected.sourceFacts!.slice(0, 5));
  });
});
