import { describe, expect, it } from 'vitest';
import type { Workspace } from '@agentdeck/shared/projects';
import {
  nativeSessionDirectory,
  parseWorkspaceUris,
  resolveProjectId,
} from '../../../src/agents/common/session-ownership';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

it('添加项目只提供唯一可解析的本机目录，不接受远程地址与多目录歧义', () => {
  const directory = path.resolve('fixtures', 'demo');
  expect(nativeSessionDirectory({ cwd: directory })).toBe(directory);
  expect(nativeSessionDirectory({ workspaceUris: pathToFileURL(directory).href })).toBe(directory);
  expect(nativeSessionDirectory({ workspaceUris: 'https://example.com' })).toBeUndefined();
  expect(nativeSessionDirectory({ workspaceUris: 'file://remote-server/share' })).toBeUndefined();
  expect(nativeSessionDirectory({ cwd: '//my-server/share/demo' })).toBeUndefined();
  if (process.platform === 'win32') expect(nativeSessionDirectory({ cwd: '/demo' })).toBeUndefined();
  expect(
    nativeSessionDirectory({
      workspaceUris: JSON.stringify([pathToFileURL(directory).href, 'file://my-server/share/demo']),
    }),
  ).toBeUndefined();
  expect(
    nativeSessionDirectory({
      workspaceUris: JSON.stringify([
        pathToFileURL(directory).href,
        pathToFileURL(path.resolve('fixtures', 'other')).href,
      ]),
    }),
  ).toBeUndefined();
});

const project = (id: string, dir: string): Workspace => ({ id, name: id, dir });

describe('parseWorkspaceUris', () => {
  it('解析 JSON 字符串数组', () => {
    expect(parseWorkspaceUris('["file:///a","file:///b"]')).toEqual(['file:///a', 'file:///b']);
  });

  it('过滤数组内的空白与空串', () => {
    expect(parseWorkspaceUris('[" file:///a ", "", "  ", "file:///b"]')).toEqual(['file:///a', 'file:///b']);
    expect(parseWorkspaceUris('[]')).toEqual([]);
  });

  it('按换行、回车与分号拆分', () => {
    expect(parseWorkspaceUris('file:///a\nfile:///b')).toEqual(['file:///a', 'file:///b']);
    expect(parseWorkspaceUris('file:///a\r\nfile:///b; file:///c;')).toEqual(['file:///a', 'file:///b', 'file:///c']);
  });

  it('单值原样返回并去掉首尾空白', () => {
    expect(parseWorkspaceUris('file:///a')).toEqual(['file:///a']);
    expect(parseWorkspaceUris('  file:///a  ')).toEqual(['file:///a']);
  });

  it('JSON 字符串标量按单值处理', () => {
    expect(parseWorkspaceUris('"file:///a"')).toEqual(['file:///a']);
  });

  it('空值或纯空白返回空数组', () => {
    expect(parseWorkspaceUris('')).toEqual([]);
    expect(parseWorkspaceUris('   \n\t')).toEqual([]);
  });
});

describe('resolveProjectId', () => {
  it('按 cwd 命中项目，子目录归属父项目', () => {
    const projects = [project('p1', 'E:\\web\\demo')];
    expect(resolveProjectId({ cwd: 'E:\\web\\demo', projects })).toBe('p1');
    expect(resolveProjectId({ cwd: 'E:\\web\\demo\\src', projects })).toBe('p1');
    expect(resolveProjectId({ cwd: 'E:\\web\\demo\\src\\deep', projects })).toBe('p1');
  });

  it('按 workspace_uris 命中项目', () => {
    expect(resolveProjectId({ workspaceUris: 'file:///E:/web/demo', projects: [project('p1', 'E:\\web\\demo')] })).toBe(
      'p1',
    );
    expect(
      resolveProjectId({
        workspaceUris: '["file:///E:/web/demo","file:///E:/web/other"]',
        projects: [project('p1', 'E:\\web\\demo')],
      }),
    ).toBe('p1');
  });

  it('命中多个项目时取配置顺序靠前者', () => {
    const projects = [project('p1', 'E:\\web\\demo'), project('p2', 'E:\\web')];
    expect(resolveProjectId({ cwd: 'E:\\web\\demo', projects })).toBe('p1');
    // 每个项目依次检查全部候选路径，而不是按 URI 顺序取第一个命中的项目。
    const byUri = [project('web', 'E:\\web'), project('demo', 'E:\\web\\demo')];
    expect(resolveProjectId({ workspaceUris: 'file:///E:/other\nfile:///E:/web/demo', projects: byUri })).toBe('web');
  });

  it('解析不出时为 null，不落到第一个项目', () => {
    const projects = [project('p1', 'E:\\web\\demo')];
    expect(resolveProjectId({ workspaceUris: '', projects })).toBeNull();
    expect(resolveProjectId({ workspaceUris: 'https://example.com/x', projects })).toBeNull();
    expect(resolveProjectId({ workspaceUris: 'E:\\web\\demo', projects })).toBeNull();
    expect(resolveProjectId({ projects })).toBeNull();
    expect(resolveProjectId({ cwd: 'web\\demo', projects })).toBeNull();
    expect(resolveProjectId({ cwd: 'E:\\web\\other', projects })).toBeNull();
  });

  it('Windows 盘符大小写、分隔符与尾斜杠统一', () => {
    const projects = [project('p1', 'E:\\web\\demo\\')];
    expect(resolveProjectId({ cwd: 'e:/web/demo/', projects })).toBe('p1');
    expect(resolveProjectId({ cwd: 'E:\\WEB\\DEMO', projects })).toBe('p1');
    expect(resolveProjectId({ workspaceUris: 'file:///e:/WEB/demo/', projects })).toBe('p1');
  });

  it('相似前缀与兄弟目录不误判', () => {
    expect(resolveProjectId({ cwd: 'E:\\web\\demo-2', projects: [project('p1', 'E:\\web\\demo')] })).toBeNull();
    expect(resolveProjectId({ cwd: 'E:\\web\\demo2', projects: [project('p1', 'E:\\web\\demo')] })).toBeNull();
    expect(resolveProjectId({ cwd: 'E:\\web\\demo\\src', projects: [project('p2', 'E:\\web\\demo-2')] })).toBeNull();
  });

  it('盘符根目录包含其下路径', () => {
    const projects = [project('root', 'C:\\')];
    expect(resolveProjectId({ cwd: 'C:\\', projects })).toBe('root');
    expect(resolveProjectId({ cwd: 'C:\\x', projects })).toBe('root');
    expect(resolveProjectId({ cwd: 'D:\\x', projects })).toBeNull();
  });

  it('file URI 的百分号编码会解码', () => {
    expect(
      resolveProjectId({ workspaceUris: 'file:///E:/web/my%20demo', projects: [project('p1', 'E:\\web\\my demo')] }),
    ).toBe('p1');
  });

  it('localhost 与 UNC 主机按本地路径解析', () => {
    expect(
      resolveProjectId({ workspaceUris: 'file://localhost/E:/web/demo', projects: [project('p1', 'E:\\web\\demo')] }),
    ).toBe('p1');
    expect(
      resolveProjectId({
        workspaceUris: 'file://server/share/demo',
        projects: [project('p1', '\\\\server\\share\\demo')],
      }),
    ).toBe('p1');
  });

  it('非 file:// 或非绝对路径的 URI 被忽略，其余仍可命中', () => {
    const projects = [project('p1', 'E:\\web\\demo')];
    expect(resolveProjectId({ workspaceUris: 'https://example.com/x\nfile:///E:/web/demo', projects })).toBe('p1');
    expect(resolveProjectId({ workspaceUris: 'file:relative/path', projects })).toBeNull();
    expect(resolveProjectId({ workspaceUris: 'file:///E:/web/100%', projects })).toBeNull();
  });

  it('POSIX 路径按 / 判父子且区分大小写', () => {
    const projects = [project('p1', '/home/me/demo')];
    expect(resolveProjectId({ cwd: '/home/me/demo', projects })).toBe('p1');
    expect(resolveProjectId({ cwd: '/home/me/demo/src', projects })).toBe('p1');
    expect(resolveProjectId({ workspaceUris: 'file:///home/me/demo/src', projects })).toBe('p1');
    expect(resolveProjectId({ cwd: '/home/me/DEMO', projects })).toBeNull();
    expect(resolveProjectId({ cwd: '/home/me/demo-2', projects })).toBeNull();
  });

  it('项目配置为空时返回 null', () => {
    expect(resolveProjectId({ cwd: 'E:\\web\\demo', projects: [] })).toBeNull();
  });
});
