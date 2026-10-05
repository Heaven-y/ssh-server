// @vitest-environment jsdom
import { type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { TurnChangesRecord, Workspace } from '@ssh-server/shared';
import { api, ApiError } from '../../../src/lib/api';
import { useChat } from '../../../src/features/chat/chat-store';
import { useChangesPanel } from '../../../src/features/changes/use-changes-panel';
import { useDiscard } from '../../../src/features/changes/use-discard';
import { SyncSettingsSchema } from '@ssh-server/shared';

const workspace: Workspace = {
  id: 'w1',
  name: 'demo',
  localDir: '.',
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
const record: TurnChangesRecord = {
  turnId: crypto.randomUUID(),
  agent: 'claude',
  sessionId: crypto.randomUUID(),
  startedAt: 1,
  phase: 'complete',
  changes: [{ path: 'main.py', kind: 'modified', additions: 1, deletions: 1, binary: false }],
};
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});
function setup() {
  useChat.getState().newSession('claude');
  useChat.setState({ workspaceId: workspace.id, sessionId: record.sessionId, latestChanges: record });
  vi.spyOn(api, 'turnChanges').mockResolvedValue({ records: [record] });
  vi.spyOn(api, 'versionStatus').mockResolvedValue({
    initialized: true,
    revision: 'a'.repeat(64),
    changes: [],
    excluded: [],
  });
  vi.spyOn(api, 'turnDiff').mockResolvedValue({
    text: 'cached diff',
    files: ['main.py'],
    truncated: false,
    changes: record.changes,
    excluded: [],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useChangesPanel({
        workspace,
        active: true,
        dirty: false,
        request: {
          workspaceId: workspace.id,
          agent: 'claude',
          conversationVersion: useChat.getState().conversationVersion,
          nonce: 'open',
          turnId: record.turnId,
        },
      }),
    { wrapper },
  );
  return { ...hook, client };
}
it('失效刷新撤下缓存diff并停止行反馈，服务端空记录不被完成事件重新合回', async () => {
  const f = setup();
  await waitFor(() => expect(f.result.current.diff.data?.text).toBe('cached diff'));
  vi.mocked(api.turnDiff).mockRejectedValue(new ApiError(409, '目标已变化', { code: 'stale_revision' }));
  await act(async () => {
    await f.result.current.diff.refetch();
  });
  await waitFor(() => expect(f.result.current.diff.isError).toBe(true));
  expect(f.result.current.feedback).toBeUndefined();
  expect(f.result.current.displayDiff).toBeUndefined();
  vi.mocked(api.turnChanges).mockResolvedValue({ records: [] });
  await act(async () => {
    await f.result.current.turns.query.refetch();
  });
  await waitFor(() => expect(f.result.current.turns.records).toEqual([]));
  expect(f.result.current.record).toBeUndefined();
});

it('工作区配置改变切换差异缓存，磁盘差异失败也停止反馈', async () => {
  const f = setup();
  await waitFor(() => expect(f.result.current.displayDiff?.text).toBe('cached diff'));
  let complete!: (value: Awaited<ReturnType<typeof api.turnDiff>>) => void;
  vi.mocked(api.turnDiff).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  act(() => {
    f.client.setQueryData(['workspaces'], [{ ...workspace, localDir: 'changed' }]);
  });
  await waitFor(() => expect(f.result.current.displayDiff).toBeUndefined());
  await waitFor(() => expect(complete).toBeDefined());
  await act(async () =>
    complete({ text: 'new target', files: ['main.py'], truncated: false, changes: record.changes, excluded: [] }),
  );
  await waitFor(() => expect(f.result.current.displayDiff?.text).toBe('new target'));
  vi.spyOn(api, 'versionStatus').mockResolvedValue({
    initialized: true,
    revision: 'b'.repeat(64),
    head: 'c'.repeat(40),
    changes: [{ path: 'main.py', kind: 'modified' }],
    excluded: [],
  });
  vi.spyOn(api, 'versionDiff').mockResolvedValue({
    text: 'working',
    files: ['main.py'],
    revision: 'b'.repeat(64),
    truncated: false,
  });
  act(() => f.result.current.choose({}));
  await act(async () => {
    await f.result.current.status.refetch();
  });
  await waitFor(() => expect(f.result.current.displayDiff?.text).toBe('working'));
  expect(f.result.current.source?.id).toBe('b'.repeat(64));
  vi.mocked(api.versionStatus).mockRejectedValue(new ApiError(409, '范围改变', { code: 'stale_revision' }));
  await act(async () => {
    await f.result.current.status.refetch();
  });
  await waitFor(() => expect(f.result.current.displayDiff).toBeUndefined());
  expect(f.result.current.feedback).toBeUndefined();
});

it('放弃陈旧预览清理确认，成功保留编辑缓冲并分别报告删除待确认和同步失败', async () => {
  const preview = {
    path: 'new.txt',
    revision: 'a'.repeat(64),
    changes: [{ path: 'new.txt', kind: 'deleted' as const }],
    excluded: [],
  };
  vi.spyOn(api, 'previewDiscard').mockResolvedValue(preview);
  vi.spyOn(api, 'discardFile')
    .mockRejectedValueOnce(new ApiError(409, '文件已变化', { code: 'stale_revision' }))
    .mockResolvedValue({
      restored: ['new.txt'],
      status: { initialized: true, revision: 'b'.repeat(64), changes: [], excluded: [] },
    });
  vi.spyOn(api, 'syncWorkspace')
    .mockResolvedValueOnce({
      phase: 'confirmation_required',
      reason: 'deletions',
      settings: SyncSettingsSchema.parse({}),
      deletions: ['new.txt'],
      conflicts: [],
    })
    .mockRejectedValueOnce(new Error('断线'));
  const f = renderHook(() => useDiscard(workspace.id));
  await act(() => f.result.current.prepare('new.txt'));
  expect(f.result.current.preview).toEqual(preview);
  await act(() => f.result.current.discard());
  expect(f.result.current.preview).toBeUndefined();
  expect(f.result.current.error).toBe('文件已变化');
  expect(api.syncWorkspace).not.toHaveBeenCalled();
  await act(() => f.result.current.prepare('new.txt'));
  await act(() => f.result.current.discard());
  expect(f.result.current.notice).toContain('服务器删除尚待');
  await act(() => f.result.current.prepare('new.txt'));
  await act(() => f.result.current.discard());
  expect(f.result.current.notice).toContain('服务器同步失败');
  expect(f.result.current.busy).toBe(false);
});
