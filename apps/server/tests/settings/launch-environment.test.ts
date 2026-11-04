import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createLaunchEnvironment } from '../../src/settings/launch-environment';

const directories: string[] = [];
async function fixture() {
  const configDir = await mkdtemp(path.join(tmpdir(), 'agentdeck-env-test-'));
  directories.push(configDir);
  const service = createLaunchEnvironment({
    configDir,
    env: { ANTHROPIC_AUTH_TOKEN: 'inherited-secret', PATH: 'native-path' },
    protector: {
      available: true,
      protect: async (value) => Buffer.from(value.toString('hex')),
      unprotect: async (value) => Buffer.from(value.toString(), 'hex'),
    },
  });
  return { service, configDir };
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

it('环境状态不返回旧值，设置加密保存，停用不会继续继承', async () => {
  const { service, configDir } = await fixture();
  const initial = await service.read('claude');
  expect(initial.variables.find((item) => item.name === 'ANTHROPIC_AUTH_TOKEN')?.source).toBe('inherited');
  const saved = await service.save('claude', {
    revision: initial.revision,
    variables: [
      { name: 'ANTHROPIC_API_KEY', mode: 'set', value: 'fixture-new-secret' },
      { name: 'ANTHROPIC_AUTH_TOKEN', mode: 'disabled' },
    ],
  });
  expect(JSON.stringify(saved)).not.toContain('fixture-new-secret');
  expect(JSON.stringify(initial)).not.toContain('inherited-secret');
  expect(await readFile(path.join(configDir, 'launch-environment.json'), 'utf8')).not.toContain('fixture-new-secret');
  expect(await service.resolve('claude')).toEqual({
    PATH: 'native-path',
    ANTHROPIC_API_KEY: 'fixture-new-secret',
    ANTHROPIC_AUTH_TOKEN: undefined,
  });
  const same = await service.save('claude', {
    revision: saved.revision,
    variables: [{ name: 'ANTHROPIC_API_KEY', mode: 'set' }],
  });
  expect((await service.resolve('claude')).ANTHROPIC_API_KEY).toBe('fixture-new-secret');
  await service.save('claude', {
    revision: same.revision,
    variables: [{ name: 'ANTHROPIC_API_KEY', mode: 'inherit' }],
  });
  expect((await service.resolve('claude')).ANTHROPIC_API_KEY).toBeUndefined();
});

it('拒绝加载器变量、跨CLI变量、重复变量和旧revision', async () => {
  const { service } = await fixture();
  for (const name of ['PATH', 'NODE_OPTIONS', 'PYTHONPATH', 'OPENAI_API_KEY'])
    await expect(
      service.save('claude', { revision: 'missing', variables: [{ name, mode: 'set', value: 'bad' }] }),
    ).rejects.toThrow();
  await expect(
    service.save('claude', {
      revision: 'missing',
      variables: [
        { name: 'ANTHROPIC_API_KEY', mode: 'inherit' },
        { name: 'ANTHROPIC_API_KEY', mode: 'disabled' },
      ],
    }),
  ).rejects.toThrow();
  await service.save('claude', {
    revision: 'missing',
    variables: [{ name: 'ANTHROPIC_AUTH_TOKEN', mode: 'disabled' }],
  });
  await expect(service.save('codex', { revision: 'missing', variables: [] })).rejects.toThrow('修改');
  expect((await service.read('antigravity')).variables.map((item) => item.name)).toContain('GEMINI_API_KEY');
  expect((await service.read('antigravity')).variables.map((item) => item.name)).not.toContain('GOOGLE_API_KEY');
});
