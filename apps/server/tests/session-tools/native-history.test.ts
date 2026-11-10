import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAntigravitySessions } from '../../src/agents/antigravity/sessions';
import { sessionToolsConfigDir } from '../../src/session-tools/runtime';

describe('MCP 原生读取选项', () => {
  it('Antigravity MCP 保留完整工具正文，普通界面仍沿用原有限制', async () => {
    const dir = path.join(os.tmpdir(), 'agentdeck-native-reader');
    const output = '完整工具输出'.repeat(12_000);
    const input = '非 JSON 工具参数'.repeat(4_000);
    const api = {
      readSummaries: () => [
        {
          conversationId: 'native-session',
          title: '演示',
          preview: '',
          lastModified: '2026-01-01 00:00:00',
          workspaceUris: pathToFileURL(dir).href,
        },
      ],
      management: {
        readTrajectory: async () => ({
          trajectory: {
            cascadeId: 'native-session',
            steps: [
              {
                type: 'CORTEX_STEP_TYPE_MCP_TOOL',
                status: 'CORTEX_STEP_STATUS_DONE',
                mcpTool: {
                  serverName: 'fixture',
                  toolCall: { name: 'read_session', argumentsJson: input },
                  resultString: output,
                },
              },
            ],
          },
        }),
        delete: async () => {
          throw new Error('不允许写入');
        },
        fork: async () => {
          throw new Error('不允许分叉');
        },
      },
    };
    const full = await createAntigravitySessions({ ...api, preserveToolContent: true }).read('native-session', dir);
    expect(full.events.find((event) => event.type === 'tool_call')).toMatchObject({ input });
    expect(full.events.find((event) => event.type === 'tool_result')).toMatchObject({ output });
    const normal = await createAntigravitySessions(api).read('native-session', dir);
    expect(normal.events.find((event) => event.type === 'tool_result')).toMatchObject({
      output: expect.stringContaining('[输出已截断]'),
    });
  });

  it('只接受明确的绝对配置目录，不回退到真实用户配置', () => {
    const dir = path.join(os.tmpdir(), 'agentdeck-mcp-config');
    expect(sessionToolsConfigDir(['--config-dir', dir])).toBe(dir);
    for (const args of [
      [],
      ['--config-dir', '.'],
      ['--config-dir', dir, '--unknown'],
      ['--config-dir', `${dir}\nprivate`],
    ]) {
      expect(() => sessionToolsConfigDir(args)).toThrow('明确的绝对配置目录');
    }
  });
});
