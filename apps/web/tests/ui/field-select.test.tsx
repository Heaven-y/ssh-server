// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { FieldSelect, FieldSuggestions } from '../../src/ui/FieldSelect';

afterEach(cleanup);
const options = [
  { value: 'model-a', label: '模型 A' },
  { value: 'model-b', label: '模型 B' },
];

function SelectFixture({ change }: { change(value: string): void }) {
  const [value, setValue] = useState('model-a');
  return (
    <dialog open aria-label="设置测试">
      <label htmlFor="field">模型</label>
      <FieldSelect
        id="field"
        label="模型"
        options={options}
        value={value}
        onChange={(next) => {
          setValue(next);
          change(next);
        }}
      />
    </dialog>
  );
}

it('固定选项弹层属于原生对话框，方向键浏览和 Esc 不提交，确认选择才写入', async () => {
  const change = vi.fn();
  render(<SelectFixture change={change} />);
  const trigger = screen.getByRole('combobox', { name: '模型' });
  fireEvent.click(trigger);
  const list = await screen.findByRole('listbox', { name: '模型选项' });
  expect(list.closest('dialog')).toBe(screen.getByRole('dialog'));
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  expect(change).not.toHaveBeenCalled();
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  fireEvent(list, escape);
  expect(escape.defaultPrevented).toBe(true);
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: '模型 B' }));
  await waitFor(() => expect(change).toHaveBeenCalledWith('model-b'));
  expect(trigger.textContent).toContain('模型 B');
});

it('模型建议保留自定义型号，重新展开可选全部目录，选择写回原始值而非显示名称', async () => {
  function SuggestionsFixture() {
    const [value, setValue] = useState('custom/private-model');
    return <FieldSuggestions id="suggestions" label="默认模型" options={options} value={value} onChange={setValue} />;
  }
  render(<SuggestionsFixture />);
  const input = screen.getByRole<HTMLInputElement>('combobox', { name: '默认模型' });
  expect(input.value).toBe('custom/private-model');
  fireEvent.click(screen.getByRole('button', { name: '展开默认模型选项' }));
  const list = await screen.findByRole('listbox');
  expect(within(list).getAllByRole('option')).toHaveLength(2);
  fireEvent.click(within(list).getByRole('option', { name: '模型 B' }));
  expect(input.value).toBe('model-b');
  fireEvent.change(input, { target: { value: 'private/new-model' } });
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await act(async () => {
    fireEvent(input, escape);
  });
  expect(escape.defaultPrevented).toBe(true);
  expect(input.value).toBe('private/new-model');
});
