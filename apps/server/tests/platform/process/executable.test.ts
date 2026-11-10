import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { resolveLocalCommand } from '../../../src/platform/process/executable';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('官方用户安装目录在 PATH 尚未刷新时可被发现，显式路径和现有 PATH 仍优先', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cli-official-paths-'));
  roots.push(root);
  const env = {
    PATH: '',
    USERPROFILE: root,
    HOME: root,
    LOCALAPPDATA: path.join(root, 'local'),
    APPDATA: path.join(root, 'roaming'),
  };
  const extension = process.platform === 'win32' ? '.exe' : '';
  const files = {
    claude: path.join(root, '.local/bin', `claude${extension}`),
    codex: path.join(env.LOCALAPPDATA, 'Programs/OpenAI/Codex/bin', `codex${extension}`),
    agy: path.join(env.LOCALAPPDATA, 'agy/bin/agy.exe'),
  };
  for (const file of Object.values(files)) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'fixture');
  }
  for (const agent of ['claude', 'codex', 'agy'] as const)
    expect(resolveLocalCommand(agent, env)).toEqual({ command: files[agent], args: [] });
  const preferred = path.join(root, `claude${extension}`);
  await writeFile(preferred, 'fixture');
  expect(resolveLocalCommand('claude', { ...env, PATH: root }).command).toBe(preferred);
  expect(() => resolveLocalCommand('claude', { ...env, CLAUDE_CODE_EXECUTABLE: path.join(root, 'missing') })).toThrow(
    '不存在',
  );
  await rm(files.claude);
  const npm = path.join(env.APPDATA, 'npm', `claude${extension}`);
  await mkdir(path.dirname(npm), { recursive: true });
  await writeFile(npm, 'fixture');
  expect(resolveLocalCommand('claude', env).command).toBe(npm);
});
