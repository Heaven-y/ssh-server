import { describe, expect, it } from 'vitest';
import { AgentProbeSchema, ProbeStatusSchema, SessionSummarySchema } from '../src/session';

describe('ProbeStatusSchema', () => {
  it('只有四种结果', () => {
    for (const status of ['available', 'missing', 'changed', 'credential-missing'])
      expect(ProbeStatusSchema.safeParse(status).success).toBe(true);
    expect(ProbeStatusSchema.safeParse('unknown').success).toBe(false);
  });
});

describe('AgentProbeSchema', () => {
  it('接受可用状态', () => {
    expect(AgentProbeSchema.parse({ agent: 'claude', status: 'available', version: '2.1.317' }).status).toBe(
      'available',
    );
  });
  it('接受接口变化状态并列出缺失能力', () => {
    const parsed = AgentProbeSchema.parse({
      agent: 'codex',
      status: 'changed',
      version: '0.166.0',
      missing: ['turn/interrupt'],
    });
    expect(parsed.missing).toEqual(['turn/interrupt']);
  });
  it('接受凭据缺失状态与说明文案', () => {
    expect(
      AgentProbeSchema.parse({ agent: 'antigravity', status: 'credential-missing', message: '未配置 GEMINI_API_KEY' })
        .message,
    ).toBe('未配置 GEMINI_API_KEY');
  });
  it('拒绝未知 agent', () => {
    expect(AgentProbeSchema.safeParse({ agent: 'gemini', status: 'available' }).success).toBe(false);
  });
});

describe('SessionSummarySchema', () => {
  it('未归属会话的 projectId 是 null', () => {
    const parsed = SessionSummarySchema.parse({
      agent: 'antigravity',
      sessionId: 'abc',
      projectId: null,
      title: '示例',
      updatedAt: '2026-11-03T12:00:00.000Z',
      running: false,
    });
    expect(parsed.projectId).toBeNull();
  });
  it('归属会话带项目 ID', () => {
    const parsed = SessionSummarySchema.parse({
      agent: 'claude',
      sessionId: 'abc',
      projectId: 'p1',
      title: '示例',
      updatedAt: '2026-11-03T12:00:00.000Z',
      running: true,
    });
    expect(parsed).toMatchObject({ projectId: 'p1', running: true });
  });
});
