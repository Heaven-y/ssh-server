import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../../src/lib/api';
import { SessionList } from '../../../src/features/workspaces/SessionList';
import { SessionActionsDialog } from '../../../src/features/workspaces/SessionActionsDialog';

describe('两类原生会话列表', () => {
  it('Codex 来源失败时保留 Claude 原生历史，并单独提供错误与重试入口', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
    });
    client.setQueryData(queryKeys.sessions('workspace', 'claude'), [
      { agent: 'claude', sessionId: 'native-id', summary: '原生历史仍可打开', lastModified: 1 },
    ]);
    await client
      .fetchQuery({
        queryKey: queryKeys.sessions('workspace', 'codex'),
        queryFn: () => Promise.reject(new Error('运行时不可用')),
      })
      .catch(() => undefined);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <SessionList workspaceId="workspace" />
      </QueryClientProvider>,
    );
    expect(html).toContain('原生历史仍可打开');
    expect(html).toContain('运行时不可用');
    expect(html.replace(/<[^>]*>/g, '')).toContain('重新读取 Codex');
    client.clear();
  });

  it('归档管理仅提供恢复和删除，删除默认不可提交', () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <SessionActionsDialog
          workspaceId="workspace"
          session={{ agent: 'codex', sessionId: 'native-id', summary: '归档记录', lastModified: 1 }}
          archived
          onClose={() => undefined}
          onCompleted={() => undefined}
        />
      </QueryClientProvider>,
    );
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([button]) => button);
    expect(buttons.map((button) => button.replace(/<[^>]*>/g, ''))).toEqual([
      '',
      '恢复到会话列表',
      '确认删除会话',
      '关闭',
    ]);
    expect(buttons.find((button) => button.includes('确认删除会话'))).toContain('disabled=""');
    expect(html).not.toContain('<form');
    expect(html).toContain('原生记录及相关子会话');
    expect(html).toContain('无法从这里撤销删除');
    client.clear();
  });
});
