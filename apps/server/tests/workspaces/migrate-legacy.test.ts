import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyConfig } from '../../src/workspaces/migrate-legacy';

const roots: string[] = [];

async function makeDirs() {
  const root = await mkdtemp(path.join(tmpdir(), 'agentdeck-migrate-'));
  roots.push(root);
  const legacyDir = path.join(root, 'ssh-server');
  const configDir = path.join(root, 'AgentDeck');
  await mkdir(legacyDir, { recursive: true });
  return { root, legacyDir, configDir };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('migrateLegacyConfig', () => {
  it('把服务器档案与工作区搬到新目录', async () => {
    const { legacyDir, configDir } = await makeDirs();
    await writeFile(path.join(legacyDir, 'servers.json'), '[{"alias":"my-server"}]');
    await writeFile(path.join(legacyDir, 'workspaces.json'), '[{"id":"w1"}]');

    const report = await migrateLegacyConfig({ legacyDir, configDir });

    expect(report.copied).toEqual(['servers.json', 'workspaces.json']);
    expect(report.errors).toEqual([]);
    await expect(readFile(path.join(configDir, 'servers.json'), 'utf8')).resolves.toContain('my-server');
    await expect(readFile(path.join(configDir, 'workspaces.json'), 'utf8')).resolves.toContain('w1');
  });

  it('不迁移已删除功能留下的 sync 与 file-editors', async () => {
    const { legacyDir, configDir } = await makeDirs();
    await writeFile(path.join(legacyDir, 'servers.json'), '[]');
    await writeFile(path.join(legacyDir, 'file-editors.json'), '{}');
    await mkdir(path.join(legacyDir, 'sync'), { recursive: true });

    const report = await migrateLegacyConfig({ legacyDir, configDir });

    expect(report.copied).toEqual(['servers.json']);
    await expect(readFile(path.join(configDir, 'file-editors.json'), 'utf8')).rejects.toThrow();
  });

  it('新目录已有同名文件时不覆盖', async () => {
    const { legacyDir, configDir } = await makeDirs();
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(legacyDir, 'servers.json'), '[{"alias":"old"}]');
    await writeFile(path.join(configDir, 'servers.json'), '[{"alias":"new"}]');

    const report = await migrateLegacyConfig({ legacyDir, configDir });

    expect(report.keptExisting).toEqual(['servers.json']);
    expect(report.copied).toEqual([]);
    await expect(readFile(path.join(configDir, 'servers.json'), 'utf8')).resolves.toContain('new');
  });

  it('旧目录不存在时什么都不做', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'agentdeck-migrate-'));
    roots.push(root);
    const report = await migrateLegacyConfig({
      legacyDir: path.join(root, 'ssh-server'),
      configDir: path.join(root, 'AgentDeck'),
    });
    expect(report.copied).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  it('旧目录保留原文件不删除', async () => {
    const { legacyDir, configDir } = await makeDirs();
    await writeFile(path.join(legacyDir, 'servers.json'), '[]');
    await migrateLegacyConfig({ legacyDir, configDir });
    await expect(readFile(path.join(legacyDir, 'servers.json'), 'utf8')).resolves.toBe('[]');
  });

  it('两个目录相同时拒绝执行', async () => {
    const { legacyDir } = await makeDirs();
    const report = await migrateLegacyConfig({ legacyDir, configDir: legacyDir });
    expect(report.errors[0]).toMatch(/相同/);
  });
});
