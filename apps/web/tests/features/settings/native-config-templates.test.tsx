// @vitest-environment jsdom
import { EditorView } from '@uiw/react-codemirror';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NativeConfigAgent, NativeConfigDocument } from '@ssh-server/shared';
import NativeConfigDialog from '../../../src/features/settings/NativeConfigDialog';
import { api, ApiError } from '../../../src/lib/api';
import { queryClient } from '../../../src/lib/query-client';

function missing(agent: NativeConfigAgent = 'claude'): NativeConfigDocument {
  return {
    agent,
    content: '',
    exists: false,
    revision: 'missing',
    format: agent === 'claude' ? 'json' : 'toml',
    displayPath: agent === 'claude' ? '~/.claude/settings.json' : '~/.codex/config.toml',
  };
}
function editor() {
  return EditorView.findFromDOM(screen.getByRole('textbox', { name: '配置文件内容' }))!;
}
function edit(content: string) {
  const view = editor();
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } }));
}
function mount(agent: NativeConfigAgent = 'claude') {
  const close = vi.fn();
  const back = vi.fn();
  return { ...render(<NativeConfigDialog agent={agent} onClose={close} onBack={back} />), close, back };
}
beforeEach(() => {
  // jsdom 不提供布局测量；保留真实 CodeMirror 的编辑与卸载行为。
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
  vi.spyOn(api, 'readAgentConfig').mockImplementation(async (agent) => missing(agent));
  vi.spyOn(api, 'saveAgentConfig').mockImplementation(async (agent, input) => ({
    ...missing(agent),
    content: input.content,
    exists: true,
    revision: 'a'.repeat(64),
  }));
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(async () => {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

it('缺失配置插入合法JSON只改草稿，关闭需确认，明确保存才创建', async () => {
  const f = mount();
  const insert = await screen.findByRole('button', { name: '插入最小模板' });
  expect(editor().state.doc.toString()).toBe('');
  expect(screen.getByText(/文件尚未创建/)).toBeTruthy();
  fireEvent.click(insert);
  expect(JSON.parse(editor().state.doc.toString())).toEqual({});
  expect(api.saveAgentConfig).not.toHaveBeenCalled();
  expect(screen.getByText(/有未保存修改/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
  expect(window.confirm).toHaveBeenCalled();
  expect(f.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '校验并保存' }));
  await screen.findByText('配置已保存到本机。');
  expect(api.saveAgentConfig).toHaveBeenCalledWith(
    'claude',
    { content: '{}\n', revision: 'missing' },
    expect.any(AbortSignal),
  );
  expect(screen.queryByText(/文件尚未创建/)).toBeNull();
  expect(screen.queryByRole('button', { name: '插入最小模板' })).toBeNull();
});

it('放弃模板不保存，返回设置后按所选 Agent 使用对应格式与说明', async () => {
  const f = mount();
  expect(screen.getByRole('heading', { name: '原生 Agent 配置 · Claude Code' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: '插入最小模板' }));
  expect(JSON.parse(editor().state.doc.toString())).toEqual({});
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '返回产品设置' }));
  expect(f.back).toHaveBeenCalledTimes(1);
  expect(api.saveAgentConfig).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: '配置文件内容' })).toBeNull();
  f.unmount();

  mount('codex');
  expect(screen.getByRole('heading', { name: '原生 Agent 配置 · Codex' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: '插入最小模板' }));
  const content = editor().state.doc.toString();
  expect(content).toContain('# model =');
  expect(content).toContain('# model_reasoning_effort =');
  expect(content.split('\n').every((line) => !line || line.startsWith('#'))).toBe(true);
  fireEvent.click(screen.getByText('查看填写说明'));
  const help = within(screen.getByRole('region', { name: '填写说明' }));
  expect(help.getByText(/原生登录/)).toBeTruthy();
  expect(help.getByText(/第三方/)).toBeTruthy();
  expect(api.saveAgentConfig).not.toHaveBeenCalled();
});

it('已有非空配置不提供覆盖模板；空文件与缺失分别说明，填写后的草稿不可被模板替换', async () => {
  const read = vi.mocked(api.readAgentConfig);
  read.mockResolvedValueOnce({
    ...missing(),
    content: '{"model":"native-model"}',
    exists: true,
    revision: 'b'.repeat(64),
  });
  mount();
  await screen.findByRole('textbox', { name: '配置文件内容' });
  expect(screen.queryByRole('button', { name: '插入最小模板' })).toBeNull();
  expect(editor().state.doc.toString()).toBe('{"model":"native-model"}');
  read.mockResolvedValueOnce({ ...missing(), exists: true, revision: 'c'.repeat(64) });
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  const insert = await screen.findByRole<HTMLButtonElement>('button', { name: '插入最小模板' });
  expect(screen.getByText(/文件已存在，但内容为空/)).toBeTruthy();
  expect(screen.queryByText(/文件尚未创建/)).toBeNull();
  edit('{"env":{}}');
  expect(insert.disabled).toBe(true);
  fireEvent.click(insert);
  expect(editor().state.doc.toString()).toBe('{"env":{}}');
  expect(api.saveAgentConfig).not.toHaveBeenCalled();
});

it('读取失败不能当作文件缺失，重试成功后才允许插模板', async () => {
  vi.mocked(api.readAgentConfig).mockRejectedValueOnce(new ApiError(500, '无法读取配置文件'));
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByText(/文件尚未创建/)).toBeNull();
  expect(screen.getByText('读取失败，无法判断文件是否存在。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '插入最小模板' })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '校验并保存' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await screen.findByRole('button', { name: '插入最小模板' });
});

it('外部新建导致409时保留模板草稿与missing修订，不自动重读或覆盖', async () => {
  vi.mocked(api.saveAgentConfig).mockRejectedValue(new ApiError(409, '配置已由其他程序修改，请重新读取'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '插入最小模板' }));
  fireEvent.click(screen.getByRole('button', { name: '校验并保存' }));
  await screen.findByRole('alert');
  expect(editor().state.doc.toString()).toBe('{}\n');
  expect(api.readAgentConfig).toHaveBeenCalledTimes(1);
  expect(api.saveAgentConfig).toHaveBeenCalledWith(
    'claude',
    { content: '{}\n', revision: 'missing' },
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  expect(api.readAgentConfig).toHaveBeenCalledTimes(1);
  expect(editor().state.doc.toString()).toBe('{}\n');
});

it('未保存配置在Escape时受保护，关闭及卸载后不保留内容或迟到结果', async () => {
  const f = mount();
  await screen.findByRole('textbox', { name: '配置文件内容' });
  edit('{"env":{"DEMO_SETTING":"synthetic-sensitive-value"}}');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(f.close).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('textbox', { name: '配置文件内容' })).toBeNull();
  f.unmount();
  let resolve!: (value: NativeConfigDocument) => void;
  vi.mocked(api.readAgentConfig).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const late = mount();
  const signal = vi.mocked(api.readAgentConfig).mock.calls.at(-1)![1]!;
  late.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ ...missing(), content: '{"model":"late-value"}' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
