import { afterEach, expect, it, vi } from 'vitest';
import { discoverAntigravityCapabilities } from '../../../src/agents/antigravity/capabilities';
import { runProcess } from '../../../src/process/run';
vi.mock('../../../src/process/executable', () => ({ resolveLocalCommand: () => ({ command: 'agy', args: [] }) }));
vi.mock('../../../src/process/run', () => ({ runProcess: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it.each([
  { exitCode: 1, stderr: 'Error: Please sign in to view available models.', expected: '请先在本机 agy 登录' },
  { exitCode: 1, stderr: 'private-diagnostic', expected: '模型列表读取失败' },
  { exitCode: 0, stderr: '', expected: '文本模型清单' },
])('模型目录状态可区分且不把文本猜成型号：$expected', async ({ exitCode, stderr, expected }) => {
  vi.mocked(runProcess).mockResolvedValue({
    exitCode,
    stdout: Buffer.from('文本模型列表'),
    stderr: Buffer.from(stderr),
  });
  const signal = new AbortController().signal;
  const result = await discoverAntigravityCapabilities('project', { signal });
  expect(result.models).toEqual([]);
  expect(result.warnings[0]).toContain(expected);
  expect(JSON.stringify(result)).not.toContain('private-diagnostic');
  expect(runProcess).toHaveBeenCalledWith(
    'agy',
    ['models'],
    expect.objectContaining({ cwd: 'project', signal, outputCap: 256 * 1024 }),
  );
});
