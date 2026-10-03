import { describe, expect, it } from 'vitest';
import type { AgentCapability } from '@ssh-server/shared';
import { matchesCapability, slashCompletion } from '../../../src/features/chat/slash-completion';

describe('原生命令补全', () => {
  it('只补全开头命令名，并保留已经输入的参数', () => {
    expect(slashCompletion('/', 1)).toEqual({ query: '', remainder: '' });
    expect(slashCompletion(' /ana 检查数据\n保留限制', 5)).toEqual({ query: 'ana', remainder: '检查数据\n保留限制' });
    expect(slashCompletion('/技能', 3)).toEqual({ query: '技能', remainder: '' });
  });

  it('路径、正文、参数区和非空选区不触发补全', () => {
    for (const text of ['/tmp/example.py', '请检查 /ana', '/ana 参数']) {
      expect(slashCompletion(text, text.length)).toBeUndefined();
    }
    expect(slashCompletion('/ana', 0)).toBeUndefined();
    expect(slashCompletion('/ana', 1, 4)).toBeUndefined();
  });

  it('按钮与输入补全共用名称、别名、描述和来源搜索', () => {
    const entry: AgentCapability = {
      id: 'skill-id',
      kind: 'skill',
      name: 'analyze',
      aliases: ['CHECK'],
      description: '检查数据',
      source: '工作区',
      available: true,
      requiresSession: false,
      supportsArguments: true,
    };
    for (const phrase of ['', 'ANA', 'check', '数据', '工作区']) expect(matchesCapability(entry, phrase)).toBe(true);
    expect(matchesCapability(entry, 'missing')).toBe(false);
  });
});
