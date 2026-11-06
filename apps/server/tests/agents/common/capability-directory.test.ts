import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { withCapabilityDirectory } from '../../../src/agents/common/capability-directory';

it('工作区失效先报告目录错误，避免三种 CLI 同时报安装或模型加载失败', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'capability-directory-'));
  const provider = vi.fn(async () => ({ models: [], entries: [], warnings: [] }));
  const discover = withCapabilityDirectory(provider);
  try {
    await writeFile(path.join(root, 'file'), 'fixture');
    for (const dir of [path.join(root, 'missing'), path.join(root, 'file')])
      await expect(discover(dir)).rejects.toMatchObject({ code: 'workspace_directory_unavailable' });
    expect(provider).not.toHaveBeenCalled();
    const signal = new AbortController().signal;
    await discover(root, signal);
    expect(provider).toHaveBeenCalledExactlyOnceWith(root, signal);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
