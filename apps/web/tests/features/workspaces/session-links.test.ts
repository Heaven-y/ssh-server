// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSessionLink, sessionLink } from '../../../src/features/workspaces/session-links';

const location = { workspaceId: 'workspace-2', agent: 'codex' as const, sessionId: 'native-id' };
describe('网页会话深度链接', () => {
  it('包含工作区、Agent与原生ID；保留当前站点路径，不复制其他查询参数', () => {
    const url = new URL(sessionLink(location, 'https://example.test/workbench?unused=1#old'));
    expect(url.origin + url.pathname).toBe('https://example.test/workbench');
    expect(url.search).toBe('');
    expect(url.hash).toBe('#session?workspace=workspace-2&agent=codex&id=native-id');
    expect(parseSessionLink(url.hash)).toEqual(location);
    const claude = { ...location, agent: 'claude' as const };
    expect(parseSessionLink(new URL(sessionLink(claude, url.href)).hash)).toEqual(claude);
  });

  it('空片段没有导航，非法片段不接受路径、额外字段、重复值或越界ID', () => {
    expect(parseSessionLink('')).toBeUndefined();
    expect(parseSessionLink('#')).toBeUndefined();
    for (const hash of [
      '#elsewhere',
      '#session?workspace=workspace-2&agent=other&id=native-id',
      '#session?workspace=workspace-2&agent=codex',
      '#session?workspace=workspace-2&agent=codex&id=a&id=b',
      '#session?workspace=workspace-2&agent=codex&id=../native',
      '#session?workspace=workspace-2&agent=codex&id=native-id&extra=1',
      '#session?workspace=%3Cscript%3E&agent=codex&id=native-id',
      `#session?workspace=workspace-2&agent=codex&id=${'a'.repeat(101)}`,
    ])
      expect(() => parseSessionLink(hash), hash).toThrow('会话链接格式无效');
  });
});
