import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentKind } from '@agentdeck/shared/conversation';
import { createNativeResourcesService } from '../../src/settings/native-resources';

const roots: string[] = [];
async function fixture() {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-resources-'));
  roots.push(homeDir);
  const project = { id: 'demo', dir: path.join(homeDir, 'project') };
  await fs.mkdir(project.dir);
  const saved: AgentKind[] = [];
  return {
    homeDir,
    project,
    saved,
    service: createNativeResourcesService({
      homeDir,
      env: {},
      onSaved: (agent) => {
        saved.push(agent);
      },
    }),
  };
}
async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('CLI 原生资源目录与编辑', () => {
  it('Antigravity 显示真实全局设置和项目 MCP，目录只返回元数据', async () => {
    const { homeDir, project, service } = await fixture();
    await write(path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json'), '{"secret":"sentinel-private"}');
    await write(path.join(project.dir, '.agents', 'mcp_config.json'), '{"mcpServers":{}}');
    const user = await service.list('antigravity');
    expect(user.entries.some((entry) => entry.kind === 'settings' && entry.scope === 'user' && entry.exists)).toBe(
      true,
    );
    expect(user.entries.every((entry) => entry.scope === 'user')).toBe(true);
    const catalog = await service.list('antigravity', project);
    expect(catalog.entries.some((entry) => entry.kind === 'mcp' && entry.scope === 'project' && entry.exists)).toBe(
      true,
    );
    expect(catalog.entries.some((entry) => entry.kind === 'settings' && entry.scope === 'project')).toBe(false);
    expect(JSON.stringify(catalog)).not.toContain('sentinel-private');
    expect(catalog.entries.every((entry) => !('content' in entry))).toBe(true);
    const settings = catalog.entries.find((entry) => entry.displayPath.endsWith('antigravity-cli/settings.json'))!;
    expect((await service.open('antigravity', settings.id, project)).content).toContain('sentinel-private');
  });

  it.each([
    ['claude', 'settings.json', '\uFEFF{\r\n  "unknown": true\r\n}\r\n'],
    ['codex', 'config.toml', '# 保留注释\r\n[unknown]\r\nenabled = true\r\n'],
    ['antigravity', 'antigravity-cli/settings.json', '{\n  "unknown": true\n}\n'],
  ] as const)('%s 显式保存原文并通知下次启动，保存响应不回显正文', async (agent, suffix, content) => {
    const { service, saved } = await fixture();
    const catalog = await service.list(agent);
    const target = catalog.entries.find((entry) => entry.displayPath.endsWith(suffix))!;
    expect(target).toMatchObject({ exists: false, editable: true });
    expect(await service.open(agent, target.id)).toMatchObject({ content: '', revision: 'missing' });
    const result = await service.save(agent, target.id, { content, revision: 'missing' });
    expect(result).not.toHaveProperty('content');
    expect(result.resource.exists).toBe(true);
    expect((await service.open(agent, target.id)).content).toBe(content);
    expect(saved).toEqual([agent]);
    await expect(service.save(agent, target.id, { content, revision: 'missing' })).rejects.toMatchObject({
      code: 'revision_conflict',
    });
    expect(saved).toHaveLength(1);
  });

  it('外部修改与跨 CLI 同一路径并发保存都保留先提交的内容', async () => {
    const { project, service } = await fixture();
    const file = path.join(project.dir, 'AGENTS.md');
    await write(file, '初始规则\n');
    const codex = (await service.list('codex', project)).entries.find((entry) => entry.displayPath === 'AGENTS.md')!;
    const agy = (await service.list('antigravity', project)).entries.find(
      (entry) => entry.displayPath === 'AGENTS.md',
    )!;
    const before = await service.open('codex', codex.id, project);
    await fs.writeFile(file, '外部更新\n');
    await expect(
      service.save('codex', codex.id, { content: '不应覆盖', revision: before.revision }, project),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    const current = await service.open('codex', codex.id, project);
    const results = await Promise.allSettled([
      service.save('codex', codex.id, { content: '第一个提交\n', revision: current.revision }, project),
      service.save('antigravity', agy.id, { content: '第二个提交\n', revision: current.revision }, project),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await fs.readFile(file, 'utf8')).toMatch(/第[一二]个提交/);
  });

  it('发现项目规则、Skills 和插件原生文件，不扫描插件脚本或普通正文', async () => {
    const { project, service } = await fixture();
    await write(path.join(project.dir, '.agents', 'rules', 'coding.md'), '# 规则\n');
    await write(path.join(project.dir, '.agents', 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\n---\n');
    await write(path.join(project.dir, '.agents', 'plugins', 'demo-plugin', 'plugin.json'), '{"name":"demo-plugin"}');
    await write(path.join(project.dir, '.agents', 'plugins', 'demo-plugin', 'mcp_config.json'), '{}');
    await write(path.join(project.dir, '.agents', 'plugins', 'demo-plugin', 'run.ts'), 'private-script');
    await write(path.join(project.dir, 'src', 'AGENTS.md'), '# 目录规则\n');
    const catalog = await service.list('antigravity', project);
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'rules', displayPath: '.agents/rules/coding.md', exists: true }),
        expect.objectContaining({ kind: 'skills', displayPath: '.agents/skills/demo-skill/SKILL.md', exists: true }),
        expect.objectContaining({
          kind: 'plugins',
          displayPath: '.agents/plugins/demo-plugin/plugin.json',
          exists: true,
        }),
        expect.objectContaining({
          kind: 'mcp',
          displayPath: '.agents/plugins/demo-plugin/mcp_config.json',
          exists: true,
        }),
        expect.objectContaining({ kind: 'rules', scope: 'directory', displayPath: 'src/AGENTS.md', exists: true }),
      ]),
    );
    expect(catalog.entries.some((entry) => entry.displayPath.endsWith('run.ts'))).toBe(false);
  });

  it('固定目录可创建规则和 Skill，重复创建与任意路径均拒绝', async () => {
    const { project, service } = await fixture();
    const catalog = await service.list('antigravity', project);
    const ruleRoot = catalog.roots.find((root) => root.kind === 'rules' && root.scope === 'project')!;
    const skillRoot = catalog.roots.find((root) => root.kind === 'skills' && root.scope === 'project')!;
    const rule = await service.create(
      'antigravity',
      { rootId: ruleRoot.id, name: '编码约定', content: '# 规则\n' },
      project,
    );
    expect(rule.resource.displayPath).toBe('.agents/rules/编码约定.md');
    expect(await fs.readFile(path.join(project.dir, '.agents', 'rules', '编码约定.md'), 'utf8')).toBe('# 规则\n');
    const skill = await service.create(
      'antigravity',
      { rootId: skillRoot.id, name: 'my-skill', content: '# Skill\n' },
      project,
    );
    expect(skill.resource.displayPath).toBe('.agents/skills/my-skill/SKILL.md');
    for (const name of [
      'MySkill',
      'my_skill',
      '含中文',
      'two words',
      '-skill',
      'skill-',
      'two--parts',
      'a'.repeat(65),
    ]) {
      await expect(
        service.create('antigravity', { rootId: skillRoot.id, name, content: '# Skill\n' }, project),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    }
    for (const name of ['x', 'a'.repeat(64)]) {
      const result = await service.create('antigravity', { rootId: skillRoot.id, name, content: '# Skill\n' }, project);
      expect(result.resource.exists).toBe(true);
    }
    const existingSkill = path.join(project.dir, '.agents', 'skills', 'Legacy_Skill', 'SKILL.md');
    await write(existingSkill, '# 已有技能\n');
    const existing = (await service.list('antigravity', project)).entries.find((entry) =>
      entry.displayPath.endsWith('Legacy_Skill/SKILL.md'),
    )!;
    const current = await service.open('antigravity', existing.id, project);
    await service.save(
      'antigravity',
      existing.id,
      { content: '# 更新已有技能\n', revision: current.revision },
      project,
    );
    expect(await fs.readFile(existingSkill, 'utf8')).toBe('# 更新已有技能\n');
    await expect(
      service.create('antigravity', { rootId: ruleRoot.id, name: '编码约定.md', content: '覆盖' }, project),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    for (const name of ['../outside', 'nested/file', 'nested\\file', 'CON', 'name.', 'name ', 'bad:name']) {
      await expect(
        service.create('antigravity', { rootId: ruleRoot.id, name, content: '' }, project),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    }
    await expect(
      service.create('antigravity', { rootId: '../outside', name: 'demo', content: '' }, project),
    ).rejects.toMatchObject({ code: 'resource_missing' });
  });

  it('损坏配置可显式读出修复，校验失败不写入且错误不含秘密', async () => {
    const { homeDir, service } = await fixture();
    const file = path.join(homeDir, '.claude', 'settings.json');
    await write(file, '{"sentinel-private": invalid}');
    const target = (await service.list('claude')).entries.find((entry) => entry.kind === 'settings')!;
    const current = await service.open('claude', target.id);
    expect(current.content).toContain('sentinel-private');
    const error: unknown = await service
      .save('claude', target.id, { content: '["sentinel-private"]', revision: current.revision })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'invalid_json' });
    expect(String(error)).not.toContain('sentinel-private');
    expect(await fs.readFile(file, 'utf8')).toBe(current.content);
  });

  it('拒绝目录和文件链接，目录发现不读取链接目标', async () => {
    const { homeDir, project, service } = await fixture();
    const outside = path.join(homeDir, 'outside');
    await write(path.join(outside, 'secret.md'), 'sentinel-private');
    await fs.mkdir(path.join(project.dir, '.agents'), { recursive: true });
    await fs.symlink(outside, path.join(project.dir, '.agents', 'rules'), 'junction');
    const catalog = await service.list('antigravity', project);
    expect(catalog.roots.find((root) => root.displayPath === '.agents/rules')).toMatchObject({ editable: false });
    expect(catalog.entries.some((entry) => entry.displayPath.endsWith('secret.md'))).toBe(false);
    const config = catalog.entries.find((entry) => entry.displayPath === '.agents/mcp_config.json')!;
    await fs.symlink(path.join(outside, 'secret.md'), path.join(project.dir, '.agents', 'mcp_config.json'), 'file');
    await expect(service.open('antigravity', config.id, project)).rejects.toMatchObject({ code: 'unsafe_path' });
    await expect(
      service.save('antigravity', config.id, { content: '{}', revision: 'missing' }, project),
    ).rejects.toMatchObject({ code: 'unsafe_path' });
    expect(await fs.readFile(path.join(outside, 'secret.md'), 'utf8')).toBe('sentinel-private');
  });

  it('项目资源 id 不可跨目录重用，丢失项目上下文也不能打开', async () => {
    const { homeDir, project, service } = await fixture();
    const target = (await service.list('codex', project)).entries.find((entry) => entry.displayPath === 'AGENTS.md')!;
    await expect(service.open('codex', target.id)).rejects.toMatchObject({ code: 'resource_missing' });
    const other = { id: project.id, dir: path.join(homeDir, 'other') };
    await fs.mkdir(other.dir);
    await expect(service.open('codex', target.id, other)).rejects.toMatchObject({ code: 'resource_missing' });
  });

  it('Claude 个人项目配置保留 local 作用域，不混入共享项目配置', async () => {
    const { project, service } = await fixture();
    const catalog = await service.list('claude', project);
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayPath: '.claude/settings.local.json', scope: 'local' }),
        expect.objectContaining({ displayPath: 'CLAUDE.local.md', scope: 'local' }),
        expect.objectContaining({ displayPath: '.claude/settings.json', scope: 'project' }),
      ]),
    );
  });

  it('Codex 设置遵从 CODEX_HOME，Skills 仍使用共享目录且命令规则保留文本格式', async () => {
    const { homeDir } = await fixture();
    const codexHome = path.join(homeDir, 'codex-profile');
    const service = createNativeResourcesService({ homeDir, env: { CODEX_HOME: codexHome } });
    await write(path.join(codexHome, 'config.toml'), '# 自选配置根\n');
    await write(path.join(codexHome, 'rules', 'default.rules'), 'prefix_rule(pattern=["demo"], decision="prompt")\n');
    await write(path.join(homeDir, '.agents', 'skills', 'shared-skill', 'SKILL.md'), '# 共享技能\n');
    const catalog = await service.list('codex');
    const settings = catalog.entries.find((entry) => entry.kind === 'settings')!;
    expect((await service.open('codex', settings.id)).content).toBe('# 自选配置根\n');
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayPath: '~/.agents/skills/shared-skill/SKILL.md', exists: true }),
        expect.objectContaining({ format: 'text', kind: 'rules', exists: true }),
      ]),
    );
    expect(catalog.roots.find((root) => root.kind === 'skills')?.displayPath).toBe('~/.agents/skills');
    const policy = catalog.entries.find((entry) => entry.format === 'text')!;
    const current = await service.open('codex', policy.id);
    const next = '# 原生命令策略\n' + current.content;
    await service.save('codex', policy.id, { content: next, revision: current.revision });
    expect(await fs.readFile(path.join(codexHome, 'rules', 'default.rules'), 'utf8')).toBe(next);
  });
});
