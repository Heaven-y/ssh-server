// @vitest-environment jsdom
import { EditorView } from '@uiw/react-codemirror';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NativeConfigAgent, NativeResourceDocument } from '@agentdeck/shared';
import NativeResourceEditor from '../../../src/features/settings/NativeResourceEditor';
import { api, ApiError } from '../../../src/lib/api';

function missing(agent: NativeConfigAgent = 'claude'): NativeResourceDocument {
  return {
    resource: {
      id: 'user-config',
      agent,
      kind: 'settings',
      scope: 'user',
      label: '用户配置',
      displayPath: agent === 'claude' ? '~/.claude/settings.json' : '~/.codex/config.toml',
      format: agent === 'claude' ? 'json' : 'toml',
      exists: false,
      editable: true,
      description: '原生配置文件。',
    },
    content: '',
    revision: 'missing',
  };
}
function editor() {
  return EditorView.findFromDOM(screen.getByRole('textbox', { name: '原生文件内容' }))!;
}
function edit(content: string) {
  const view = editor();
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } }));
}
function mount(agent: NativeConfigAgent = 'claude') {
  const close = vi.fn();
  return {
    ...render(
      <NativeResourceEditor context={{ agent }} resource={missing(agent).resource} onClose={close} onBack={vi.fn()} />,
    ),
    close,
  };
}
beforeEach(() => {
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(api, 'openNativeResource').mockImplementation(async ({ agent }) => missing(agent as NativeConfigAgent));
  vi.spyOn(api, 'saveNativeResource').mockImplementation(async ({ agent }) => ({
    resource: { ...missing(agent as NativeConfigAgent).resource, exists: true },
    revision: 'saved',
  }));
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

it('空配置模板只修改草稿，明确保存才创建文件，成功后以当前正文作为新基准', async () => {
  const mounted = mount();
  fireEvent.click(await screen.findByRole('button', { name: '插入最小模板' }));
  expect(JSON.parse(editor().state.doc.toString())).toEqual({});
  expect(api.saveNativeResource).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
  expect(mounted.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存文件' }));
  await screen.findByText(/文件已保存/);
  expect(api.saveNativeResource).toHaveBeenCalledWith(
    { agent: 'claude' },
    'user-config',
    { content: '{}\n', revision: 'missing' },
    expect.any(AbortSignal),
  );
  expect(screen.queryByRole('button', { name: '插入最小模板' })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存文件' }).disabled).toBe(true);
});

it('Codex使用注释模板；非空配置与已填写草稿不可被模板覆盖', async () => {
  const mounted = mount('codex');
  fireEvent.click(await screen.findByRole('button', { name: '插入最小模板' }));
  expect(
    editor()
      .state.doc.toString()
      .split('\n')
      .every((line) => !line || line.startsWith('#')),
  ).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '插入最小模板' }).disabled).toBe(true);
  mounted.unmount();
  vi.mocked(api.openNativeResource).mockResolvedValueOnce({
    ...missing(),
    content: '{"model":"native-model"}',
    resource: { ...missing().resource, exists: true },
  });
  mount();
  await screen.findByRole('textbox', { name: '原生文件内容' });
  expect(screen.queryByRole('button', { name: '插入最小模板' })).toBeNull();
});

it('读取失败不显示创建提示与模板，显式重读成功才允许编辑', async () => {
  vi.mocked(api.openNativeResource).mockRejectedValueOnce(new ApiError(500, '文件读取失败。'));
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText(/文件尚未创建/)).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存文件' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新读取文件' }));
  await screen.findByRole('button', { name: '插入最小模板' });
  edit('{"env":{}}');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '插入最小模板' }).disabled).toBe(true);
});
