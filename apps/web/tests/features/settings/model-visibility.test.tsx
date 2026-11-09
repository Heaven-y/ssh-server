// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProductSettingsSchema } from '@agentdeck/shared/settings';
import { ModelVisibilityPanel } from '../../../src/features/settings/ModelVisibilityPanel';
import { settingsApi } from '../../../src/features/settings/api';
import { useChat } from '../../../src/features/chat/chat-store';
import { queryClient } from '../../../src/lib/query-client';
import { settingsKeys } from '../../../src/features/settings/api';

async function checkbox(name: string) {
  const input = await screen.findByRole<HTMLInputElement>('checkbox', { name });
  await waitFor(() => expect(input.disabled).toBe(false));
  return input;
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  useChat.setState(useChat.getInitialState(), true);
});
it('旧面板保存响应迟到时不覆盖新面板已保存的模型范围', async () => {
  let document = { settings: ProductSettingsSchema.parse({}), revision: 'a'.repeat(64) };
  vi.spyOn(settingsApi, 'readProductSettings').mockImplementation(async () => document);
  let complete!: (result: typeof document) => void;
  let previous: typeof document;
  vi.spyOn(settingsApi, 'saveProductSettings')
    .mockImplementationOnce((input) => {
      document = { settings: input.settings, revision: 'b'.repeat(64) };
      previous = document;
      return new Promise((resolve) => {
        complete = resolve;
      });
    })
    .mockImplementationOnce(async (input) => {
      document = { settings: input.settings, revision: 'c'.repeat(64) };
      return document;
    });
  const models = [
    { id: 'one', label: 'one' },
    { id: 'two', label: 'two' },
  ];
  const first = render(<ModelVisibilityPanel agent="claude" models={models} />);
  fireEvent.click(await checkbox('显示 two'));
  await waitFor(() => expect(complete).toBeDefined());
  first.unmount();
  render(<ModelVisibilityPanel agent="claude" models={models} />);
  fireEvent.click(await checkbox('显示 one'));
  await waitFor(() => expect(useChat.getState().defaults.modelVisibility?.claude).toEqual([]));
  await act(async () => complete(previous));
  expect(useChat.getState().defaults.modelVisibility?.claude).toEqual([]);
  expect(queryClient.getQueryData(settingsKeys.productSettings)).toEqual(document);
});
it('设置勾选保存工作台范围并立即应用，保留其他 CLI 与原生配置，重开和刷新不重选', async () => {
  let document = {
    settings: ProductSettingsSchema.parse({ modelVisibility: { codex: ['gpt'] } }),
    revision: 'a'.repeat(64),
  };
  vi.spyOn(settingsApi, 'readProductSettings').mockImplementation(async () => document);
  const save = vi.spyOn(settingsApi, 'saveProductSettings').mockImplementation(async (input) => {
    document = { settings: input.settings, revision: 'b'.repeat(64) };
    return document;
  });
  const models = [
    { id: 'one', label: 'one' },
    { id: 'two', label: 'two' },
  ];
  const view = render(<ModelVisibilityPanel agent="claude" models={models} />);
  fireEvent.click(await checkbox('显示 two'));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  await waitFor(() => expect(useChat.getState().defaults.modelVisibility).toEqual({ codex: ['gpt'], claude: ['one'] }));
  view.unmount();
  render(<ModelVisibilityPanel agent="claude" models={[...models, { id: 'new', label: 'new' }]} />);
  expect((await checkbox('显示 two')).checked).toBe(false);
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: '显示 new' }).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '恢复全部模型' }));
  await waitFor(() => expect(useChat.getState().defaults.modelVisibility).toEqual({ codex: ['gpt'] }));
});
