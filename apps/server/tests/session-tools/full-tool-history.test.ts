import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { formatSessionReference, type AgentEvent, type AgentKind } from '@agentdeck/shared/conversation';
import { createClaudeSessions, type ClaudeSessionsApi } from '../../src/agents/claude/sessions';
import { readCodexSession } from '../../src/agents/codex/sessions';
import { createSessionPagination, readableHistory, type SessionReadItem } from '../../src/session-tools/pagination';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const output = '原生工具结果'.repeat(5000) + '读取末尾';

function verifyPages(events: AgentEvent[], agent: AgentKind, dir: string) {
  const pagination = createSessionPagination();
  const reference = formatSessionReference({ workspaceId: 'demo', agent, sessionId: 'native-session' });
  const fragments: SessionReadItem[] = [];
  let cursor: string | undefined;
  let count = 0;
  do {
    const page = pagination.read({ reference, workspaceDir: dir, history: readableHistory(events), cursor });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(8192);
    fragments.push(...page.items.filter((item) => item.type === 'tool_result'));
    cursor = page.nextCursor;
    expect(++count).toBeLessThan(30);
  } while (cursor);
  const result = JSON.parse(fragments.map((item) => item.content).join('')) as { output: string };
  expect(result.output.length).toBe(output.length);
  expect(result.output.endsWith('读取末尾')).toBe(true);
  expect(result.output === output).toBe(true);
  expect(fragments.at(-1)!.complete).toBe(true);
  expect(fragments.length).toBeGreaterThan(1);
}

function verifyDefaultTruncation(events: AgentEvent[]) {
  const result = events.find((event) => event.type === 'tool_result');
  expect(result?.output.length).toBeLessThan(20_100);
  expect(result?.output).toContain('[已截断');
  expect(result?.output.endsWith('读取末尾')).toBe(false);
}

describe('MCP 从原生映射到分页保留完整工具结果', () => {
  it('Claude 原生消息经 provider/mapper 后仍能分页读到长输出末尾，默认显示继续截断', async () => {
    const dir = path.join(os.tmpdir(), 'agentdeck-full-claude-history');
    const api: ClaudeSessionsApi = {
      list: async () => [],
      info: async (id) => ({ sessionId: id, summary: '演示', lastModified: 1, cwd: dir }),
      messages: async () => [
        {
          type: 'user',
          uuid: 'tool-message',
          session_id: 'native-session',
          parent_tool_use_id: null,
          parent_agent_id: null,
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'long-tool', content: [{ type: 'text', text: output }] }],
          },
        },
      ],
      rename: async () => {
        throw new Error('测试不允许写入');
      },
      delete: async () => {
        throw new Error('测试不允许删除');
      },
      fork: async () => {
        throw new Error('测试不允许分叉');
      },
    };
    const full = await createClaudeSessions(api, undefined, { preserveToolContent: true }).read('native-session', dir);
    verifyPages(full.events, 'claude', dir);
    verifyDefaultTruncation((await createClaudeSessions(api).read('native-session', dir)).events);
  });

  it('Codex thread/read 经真实 mapper 后仍能分页读到长输出末尾，默认显示继续截断', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-full-codex-history-'));
    dirs.push(dir);
    const options = {
      command: {
        command: process.execPath,
        args: [
          '--import',
          import.meta.resolve('tsx'),
          fileURLToPath(new URL('../agents/codex/fake-app-server.ts', import.meta.url)),
        ],
      },
      env: { CODEX_HOME: dir, CODEX_TEST_MODE: 'long-tool-history' },
    };
    const full = await readCodexSession('native-thread', dir, { ...options, preserveToolContent: true });
    verifyPages(full.events, 'codex', dir);
    verifyDefaultTruncation((await readCodexSession('native-thread', dir, options)).events);
  });
});
