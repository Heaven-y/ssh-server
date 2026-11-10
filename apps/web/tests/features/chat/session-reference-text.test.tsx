// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionReferenceText, sessionMarkdownUrl } from '../../../src/features/chat/SessionReferenceText';
import { MessageItem } from '../../../src/features/chat/MessageItem';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

it('助手 Markdown 与裸会话链接都可点击，代码中的引用保持代码', () => {
  const reference = 'agentdeck://session?workspace=p&agent=codex&id=s';
  render(
    <MessageItem
      item={{
        kind: 'assistant',
        id: 'answer',
        streaming: false,
        text: `[旧会话](${reference})\n\n${reference}\n\n\`${reference}\``,
      }}
    />,
  );
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(screen.getByRole('link', { name: '旧会话' }).getAttribute('href')).toBe(
    '#session?workspace=p&agent=codex&id=s',
  );
  expect(document.querySelector('code')?.textContent).toBe(reference);
});
it('点击正文会话引用在本页导航，保持中文上下文与无效引用', () => {
  const reference = 'agentdeck://session?workspace=project-1&agent=claude&id=session-1';
  render(<SessionReferenceText text={`请继续 ${reference}，之后阅读 native-id。`} />);
  const link = screen.getByRole('link');
  const open = vi.fn();
  window.addEventListener('agentdeck:session-open', open);
  fireEvent.click(link);
  expect(window.location.hash).toBe('#session?workspace=project-1&agent=claude&id=session-1');
  fireEvent.click(link);
  expect(open).toHaveBeenCalledOnce();
  expect(screen.getByText(/，之后阅读 native-id。/)).toBeTruthy();
  window.removeEventListener('agentdeck:session-open', open);
});
it('Markdown 仅放行完整的会话身份，不扩宽脚本和图片 URL 的协议', () => {
  const node = { type: 'element' as const, tagName: 'a', properties: {}, children: [] };
  expect(sessionMarkdownUrl('agentdeck://session?workspace=p&agent=codex&id=s', 'href', node)).toBe(
    '#session?workspace=p&agent=codex&id=s',
  );
  expect(sessionMarkdownUrl('javascript:alert(1)', 'href', node)).toBe('');
  expect(sessionMarkdownUrl('agentdeck://session?workspace=p&agent=codex&id=s', 'src', node)).toBe('');
});
