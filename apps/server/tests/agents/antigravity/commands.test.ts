import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { antigravityInvocationText, discoverAntigravityCommands } from '../../../src/agents/antigravity/commands';
import { antigravityCommandEntries, antigravityNativeSkills } from '../../../src/agents/antigravity/command-catalog';
import { startManagementBackend } from '../../../src/agents/antigravity/management-process';
import { runProcess } from '../../../src/platform/process/run';
import type { AgentTurnInput } from '../../../src/agents/contracts';

vi.mock('../../../src/platform/process/executable', () => ({
  resolveLocalCommand: () => ({ command: 'agy', args: [] }),
}));
vi.mock('../../../src/platform/process/run', () => ({ runProcess: vi.fn() }));
vi.mock('../../../src/agents/antigravity/management-process', () => ({ startManagementBackend: vi.fn() }));
let root = '';
let profile = '';
const close = vi.fn(async () => {});
const request = vi.fn();
const options = () => ({
  homeDir: root,
  env: { USERPROFILE: root, HOME: root, GEMINI_API_KEY: 'private-key', AGY_ADC_AUTH: 'true' },
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-agy-commands-test-'));
  vi.mocked(runProcess).mockImplementation(async (_command, args, context) => {
    profile = context.cwd!;
    expect(profile).not.toBe(root);
    expect(context.env).toMatchObject({
      USERPROFILE: profile,
      GEMINI_API_KEY: 'agentdeck-local-catalog',
      GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:9',
    });
    expect(context.env).not.toHaveProperty('AGY_ADC_AUTH');
    const config = await readFile(path.join(profile, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8');
    expect(JSON.parse(config)).toEqual({ modelProvider: 'gemini', enableTelemetry: false });
    expect(args[0]).toBe('--print');
    return {
      exitCode: 0,
      stderr: Buffer.alloc(0),
      stdout: Buffer.from(
        args[1] === '/help' ? '/model\t模型\n/config (settings)\t设置\n' : 'builtin-review\t内置审查\n',
      ),
    };
  });
  vi.mocked(startManagementBackend).mockResolvedValue({ request, close });
  request.mockResolvedValue({ skills: [] });
});
afterEach(async () => {
  vi.resetAllMocks();
  await rm(root, { recursive: true });
});

function skill(name: string, source: string, local = false, disabled = false) {
  return {
    name,
    path: path.join(root, source, name, 'SKILL.md'),
    description: source,
    scope: local ? { localScope: {} } : { globalScope: {} },
    disableSlashCommand: disabled,
  };
}

it('原生清单保持工作区优先，CLI 与 Shared 覆盖普通全局；不回传正文或调用禁用技能', async () => {
  request
    .mockResolvedValueOnce({
      skills: [
        skill('review', 'workspace', true),
        skill('fallback', 'global'),
        skill('off', 'global', false, true),
        skill('model', 'workspace', true),
      ],
    })
    .mockResolvedValueOnce({ skills: [skill('review', 'shared'), skill('fallback', 'shared')] })
    .mockResolvedValueOnce({ skills: [skill('review', 'cli'), skill('fallback', 'cli')] });
  const entries = await discoverAntigravityCommands(root, options());
  expect(entries.find((entry) => entry.name === 'review')).toMatchObject({
    available: true,
    description: 'workspace',
    invocation: { path: path.join(root, 'workspace', 'review', 'SKILL.md') },
  });
  expect(entries.find((entry) => entry.name === 'fallback')).toMatchObject({ description: 'cli' });
  expect(entries.find((entry) => entry.name === 'off')).toMatchObject({ available: false });
  expect(entries.find((entry) => entry.kind === 'skill' && entry.name === 'model')).toMatchObject({ available: false });
  expect(entries.find((entry) => entry.name === 'builtin-review')).toMatchObject({
    available: true,
    invocation: { name: 'builtin-review' },
  });
  expect(entries.find((entry) => entry.name === 'config')).toMatchObject({ aliases: ['settings'], available: false });
  expect(request).toHaveBeenNthCalledWith(1, 'GetAllSkills', {
    workspaceUris: [pathToFileURL(root).href],
    globalCustomizationDirs: [path.join(root, '.gemini', 'config')],
  });
  expect(close).toHaveBeenCalledOnce();
  await expect(stat(profile)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('目录格式变化直接失败并关闭原生服务，不把说明文字当作技能', async () => {
  request.mockResolvedValue({ renamedSkills: [] });
  await expect(discoverAntigravityCommands(root, options())).rejects.toThrow('格式');
  expect(close).toHaveBeenCalledOnce();
  await expect(stat(profile)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(() => antigravityCommandEntries('plain error message')).toThrow();
  expect(() => antigravityCommandEntries('/invalid/name\t说明')).toThrow();
  expect(antigravityNativeSkills({ skills: [{ name: 'valid', path: '../unverified' }] })).toEqual([]);
});

it('发送前核对技能身份；变更路径、内建命令或同名冲突不能变成模型提示词', async () => {
  const input: AgentTurnInput = {
    workspace: { id: 'p', name: '项目', dir: root },
    text: '检查这处修改',
    invocation: { kind: 'skill', name: 'review', path: path.join(root, 'workspace', 'review', 'SKILL.md') },
    emit: () => {},
    requestPermission: async () => ({ allow: false }),
  };
  request.mockImplementation(async (_method: unknown, params: { workspaceUris: string[] }) => ({
    skills: params.workspaceUris.length ? [skill('review', 'workspace', true)] : [],
  }));
  expect(await antigravityInvocationText(input, options())).toBe('/review 检查这处修改');
  await expect(
    antigravityInvocationText(
      { ...input, invocation: { kind: 'skill', name: 'review', path: path.join(root, 'other') } },
      options(),
    ),
  ).rejects.toThrow('已变化');
  await expect(
    antigravityInvocationText({ ...input, invocation: { kind: 'command', name: 'compact' } }, options()),
  ).rejects.toThrow('尚未接入');
});

it('取消目录读取不会启动 CLI 或原生服务', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(discoverAntigravityCommands(root, { ...options(), signal: controller.signal })).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(runProcess).not.toHaveBeenCalled();
  expect(startManagementBackend).not.toHaveBeenCalled();
});
