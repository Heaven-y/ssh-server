import { describe, expect, it } from 'vitest';
import {
  formatSessionReference,
  parseSessionReference,
  sessionReferenceHash,
} from '../src/conversation/session-reference';

describe('稳定会话引用', () => {
  it.each(['claude', 'codex', 'antigravity'] as const)('保留 %s 的原生身份并兼容旧网页链接', (agent) => {
    const target = { workspaceId: 'project-1', agent, sessionId: 'native-2' };
    const reference = formatSessionReference(target);
    expect(reference).toBe(`agentdeck://session?workspace=project-1&agent=${agent}&id=native-2`);
    expect(parseSessionReference(reference)).toEqual(target);
    expect(parseSessionReference(`https://example.test/workbench${sessionReferenceHash(target)}`)).toEqual(target);
    expect(parseSessionReference(sessionReferenceHash(target))).toEqual(target);
  });

  it('拒绝混淆的协议、权限、字段和路径', () => {
    for (const value of [
      'native-2',
      'javascript:alert(1)',
      'file:///tmp/session',
      'agentdeck://other?workspace=p&agent=codex&id=s',
      'agentdeck://user@session?workspace=p&agent=codex&id=s',
      'agentdeck://session:123?workspace=p&agent=codex&id=s',
      'agentdeck://session/path?workspace=p&agent=codex&id=s',
      'agentdeck://session?workspace=p&agent=codex&id=s#ignored',
      'agentdeck://session?workspace=p&agent=codex&id=s&id=other',
      'agentdeck://session?workspace=p&agent=codex&id=s&extra=1',
      'agentdeck://session?workspace=p&agent=codex&id=../escape',
      'agentdeck://session?workspace=p&agent=unknown&id=s',
      `agentdeck://session?workspace=p&agent=codex&id=${'s'.repeat(101)}`,
    ])
      expect(() => parseSessionReference(value), value).toThrow('会话链接格式无效');
  });
});
