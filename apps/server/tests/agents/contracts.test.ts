import { expectTypeOf, it } from 'vitest';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeQuery } from '../../src/agents/claude-query';
import type { ClaudeSessionsApi } from '../../src/agents/claude-sessions';
import type { SessionProvider, createSessionsService } from '../../src/chat/sessions';
import type { TurnManagerDeps } from '../../src/chat/turn-manager';
import type { sampleResourceCommand } from '../../src/resources/sample';

it('固定SDK控制方法与原生会话管理均为必需契约', () => {
  type Controls = Pick<ClaudeQuery, 'close' | 'supportedCommands' | 'supportedModels' | 'getContextUsage'>;
  expectTypeOf<Controls>().toEqualTypeOf<Pick<Query, keyof Controls>>();
  expectTypeOf<ClaudeSessionsApi>().toEqualTypeOf<Required<ClaudeSessionsApi>>();
  expectTypeOf<SessionProvider>().toEqualTypeOf<Required<SessionProvider>>();
  type Operations = Parameters<typeof createSessionsService>[1];
  expectTypeOf<Operations>().toEqualTypeOf<NonNullable<Operations>>();
});

it('运行器及资源采样只有显式入口', () => {
  type Runners = Pick<TurnManagerDeps, 'runners'>;
  expectTypeOf<Runners>().toEqualTypeOf<Required<Runners>>();
  expectTypeOf<'runTurn' extends keyof TurnManagerDeps ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<Parameters<typeof sampleResourceCommand>[3]>().toEqualTypeOf<{
    signal: AbortSignal;
    timeoutMs: number;
  }>();
});
