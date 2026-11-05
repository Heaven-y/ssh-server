import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { discoverAntigravityCapabilities } from '../../../src/agents/antigravity/capabilities';
import { parseAntigravityModelList } from '../../../src/agents/antigravity/model-catalog';
import { runProcess } from '../../../src/process/run';
vi.mock('../../../src/process/executable', () => ({ resolveLocalCommand: () => ({ command: 'agy', args: [] }) }));
vi.mock('../../../src/process/run', () => ({ runProcess: vi.fn() }));

const roots: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(config: unknown) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-agy-capabilities-'));
  roots.push(homeDir);
  const native = path.join(homeDir, '.gemini', 'antigravity-cli');
  await mkdir(native, { recursive: true });
  await writeFile(path.join(native, 'settings.json'), JSON.stringify(config));
  return homeDir;
}

it('账号模式只读已配置模型，不启动可能加载 MCP 的真实 CLI', async () => {
  const homeDir = await fixture({ model: 'Example Native' });
  const catalog = await discoverAntigravityCapabilities('project', { homeDir, env: {} });
  expect(catalog.models).toEqual([{ id: 'Example Native', label: 'Example Native', description: '原生默认模型' }]);
  expect(catalog.modelWarning).toBe('');
  expect(runProcess).not.toHaveBeenCalled();
});

it('Gemini 发现隔离用户目录和工作目录，保持原生 TSV 标识且不复制密钥或执行扩展', async () => {
  const homeDir = await fixture({
    modelProvider: 'gemini',
    model: '自定义显示名',
    hooks: { startup: 'must-not-run' },
    customModelsConfig: {
      customModels: {
        custom: {
          modelName: 'gemini-api://example.test/models/custom',
          label: '自定义显示名',
          maxTokens: 100000,
          unknown: 'must-not-copy',
        },
      },
    },
  });
  let isolated = '';
  const signal = new AbortController().signal;
  vi.mocked(runProcess).mockImplementation(async (_command, args, options) => {
    expect(args).toEqual(['models']);
    isolated = options.cwd!;
    expect(isolated).not.toBe(homeDir);
    expect(options.env).toMatchObject({
      HOME: isolated,
      USERPROFILE: isolated,
      GEMINI_API_KEY: 'fixture-key',
      GOOGLE_GEMINI_BASE_URL: 'https://example.test',
    });
    expect(options.signal).toBe(signal);
    const content = await readFile(path.join(isolated, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8');
    const checked = await stat(path.join(isolated, '.gemini', 'antigravity-cli', 'last_check.timestamp'));
    expect(Date.now() - checked.mtimeMs).toBeLessThan(5000);
    expect(content).not.toMatch(/fixture-key|must-not-run|must-not-copy/);
    expect(JSON.parse(content)).toMatchObject({
      enableTelemetry: false,
      customModelsConfig: { customModels: { custom: { maxTokens: 100000 } } },
    });
    return {
      exitCode: 0,
      stderr: Buffer.from('Fetching available models...'),
      stdout: Buffer.from('gemini-example-high\tGemini Example (High)\n自定义显示名\t自定义显示名\n'),
    };
  });
  const result = await discoverAntigravityCapabilities('project', {
    homeDir,
    signal,
    env: { GEMINI_API_KEY: 'fixture-key', GOOGLE_GEMINI_BASE_URL: 'https://example.test' },
  });
  expect(result.models).toEqual([
    { id: 'gemini-example-high', label: 'Gemini Example (High)' },
    { id: '自定义显示名', label: '自定义显示名' },
  ]);
  expect(result.modelWarning).toBe('');
  await expect(stat(isolated)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('发现失败清理隔离目录，保留配置模型而不泄露子进程诊断', async () => {
  const homeDir = await fixture({ modelProvider: 'gemini', model: 'Configured' });
  let isolated = '';
  vi.mocked(runProcess).mockImplementation(async (_command, _args, options) => {
    isolated = options.cwd!;
    return { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('private-diagnostic') };
  });
  const result = await discoverAntigravityCapabilities('project', { homeDir, env: { GEMINI_API_KEY: 'fixture-key' } });
  expect(result.models.map((model) => model.id)).toEqual(['Configured']);
  expect(result.modelWarning).toContain('已保留');
  expect(JSON.stringify(result)).not.toContain('private-diagnostic');
  await expect(stat(isolated)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('Gemini 缺少 Key 只提示配置，旧数组格式不能伪装成可用自定义模型', async () => {
  const homeDir = await fixture({
    modelProvider: 'gemini',
    customModelsConfig: { customModels: [{ label: 'ignored', modelName: 'gemini-api://example.test/models/custom' }] },
  });
  const result = await discoverAntigravityCapabilities('project', { homeDir, env: {} });
  expect(result.models).toEqual([]);
  expect(result.modelWarning).toContain('API Key');
  expect(runProcess).not.toHaveBeenCalled();
});

it('格式变化拒绝把说明文字当模型，取消发现清理临时目录并传播取消', async () => {
  expect(() => parseAntigravityModelList('Unexpected model listing')).toThrow();
  const homeDir = await fixture({ modelProvider: 'gemini' });
  const controller = new AbortController();
  let isolated = '';
  vi.mocked(runProcess).mockImplementation(async (_command, _args, options) => {
    isolated = options.cwd!;
    controller.abort();
    throw new Error('cancelled');
  });
  await expect(
    discoverAntigravityCapabilities('project', {
      homeDir,
      signal: controller.signal,
      env: { GEMINI_API_KEY: 'fixture-key' },
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  await expect(stat(isolated)).rejects.toMatchObject({ code: 'ENOENT' });
});
