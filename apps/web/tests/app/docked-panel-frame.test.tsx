// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspacePanelFrame } from '../../src/app/WorkspacePanelFrame';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount() {
  function Example() {
    const [opened, setOpened] = useState(true);
    return (
      <>
        <button aria-controls="workspace-files-panel" onClick={() => setOpened(true)}>
          重新打开
        </button>
        <WorkspacePanelFrame kind="files" opened={opened} hide={() => setOpened(false)}>
          <input aria-label="保留内容" defaultValue="原始内容" />
          <dialog open>
            <button>子框操作</button>
          </dialog>
        </WorkspacePanelFrame>
      </>
    );
  }
  render(<Example />);
  return screen.getByRole('complementary', { name: '文件面板' });
}
it('工具面板使用停靠宿主，不保留自由浮窗移动和角落缩放操作', () => {
  const panel = mount();
  expect(panel.classList.contains('fixed')).toBe(false);
  expect(screen.queryByRole('button', { name: '移动文件面板' })).toBeNull();
  expect(screen.queryByRole('button', { name: '调整文件面板大小' })).toBeNull();
});
it('收起保留同一输入子树和未保存内容，重新打开恢复', () => {
  const panel = mount();
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: '保留内容' });
  fireEvent.change(input, { target: { value: '未保存内容' } });
  fireEvent.click(screen.getByRole('button', { name: '收起文件面板' }));
  expect(panel.hidden).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新打开' }));
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input.value).toBe('未保存内容');
});
it('子弹窗消费Escape时不连带收起外层停靠面板', () => {
  const panel = mount();
  fireEvent.keyDown(screen.getByRole('button', { name: '子框操作' }), { key: 'Escape' });
  expect(panel.hidden).toBe(false);
});
it('面板自己的Escape返回对应顶栏入口，不影响子树保存', () => {
  const panel = mount();
  const input = screen.getByRole('textbox');
  input.focus();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(panel.hidden).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '重新打开' }));
});
