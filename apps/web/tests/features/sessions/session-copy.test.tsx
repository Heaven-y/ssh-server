// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSessionLinkCopy } from '../../../src/features/sessions/use-session-link-copy';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('复制分别输出稳定链接和原生 ID，剪贴板不可用时返回手动复制内容', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const { result } = renderHook(() => useSessionLinkCopy('project-1'));
  const session = { agent: 'claude' as const, sessionId: 'native-1', title: '示例' };
  await act(() => result.current.copy(session));
  expect(writeText).toHaveBeenLastCalledWith('agentdeck://session?workspace=project-1&agent=claude&id=native-1');
  await act(() => result.current.copy(session, 'id'));
  expect(writeText).toHaveBeenLastCalledWith('native-1');
  writeText.mockRejectedValue(new Error('denied'));
  await act(() => result.current.copy(session));
  expect(result.current.link).toBe('agentdeck://session?workspace=project-1&agent=claude&id=native-1');
  expect(result.current.notice).toContain('手动复制');
});
