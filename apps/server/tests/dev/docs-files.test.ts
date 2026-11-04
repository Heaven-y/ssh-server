import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { markdownFiles } from '../../../../scripts/dev/docs-files';

const repositories: string[] = [];

function repository(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'agentdeck-docs-'));
  repositories.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  return root;
}

function write(root: string, relative: string, text = '# 文档\n'): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text, 'utf8');
}

afterEach(() => {
  for (const root of repositories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('文档工作树枚举', () => {
  it('同时检查现有跟踪与未跟踪文档，跳过未暂存删除并保留中文空格路径', () => {
    const root = repository();
    write(root, 'README.md');
    write(root, 'docs/retired.md');
    execFileSync('git', ['add', 'README.md', 'docs/retired.md'], { cwd: root });
    rmSync(path.join(root, 'docs/retired.md'));
    write(root, 'docs/中文目录/新增 说明.md');
    write(root, 'docs/data.json', '{}');

    expect(markdownFiles(root)).toEqual(['README.md', 'docs/中文目录/新增 说明.md']);
  });

  it('排除忽略的新文件以及技能和临时记录，即使临时文件被意外跟踪', () => {
    const root = repository();
    write(root, '.gitignore', 'ignored/\nnode_modules/\n');
    write(root, 'docs/current.md');
    write(root, 'ignored/draft.md');
    write(root, 'node_modules/package/README.md');
    write(root, '.agents/skills/example/SKILL.md');
    write(root, '.claude/skills/example/SKILL.md');
    write(root, '.superpowers/run/progress.md');
    write(root, '.pi/draft.md');
    execFileSync('git', ['add', '.superpowers/run/progress.md'], { cwd: root });

    expect(markdownFiles(root)).toEqual(['docs/current.md']);
  });
});
