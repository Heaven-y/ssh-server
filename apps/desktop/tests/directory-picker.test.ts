import os from 'node:os';
import path from 'node:path';
import type { OpenDialogOptions, OpenDialogReturnValue } from 'electron';
import { expect, it, vi } from 'vitest';
import { createDirectoryPicker } from '../src/directory-picker';

const url = 'http://127.0.0.1:4317/';
const directory = path.join(os.tmpdir(), 'agentdeck-picker', 'demo');
const selected = { canceled: false, filePaths: [directory] };

function setup() {
  const frame = { url };
  const contents = { isDestroyed: () => false, mainFrame: frame };
  const owner = { isDestroyed: () => false, webContents: contents };
  const open = vi.fn<(options: OpenDialogOptions) => Promise<OpenDialogReturnValue>>().mockResolvedValue(selected);
  return {
    frame,
    owner,
    open,
    request: { sender: contents, senderFrame: frame },
    picker: createDirectoryPicker(owner, url, open),
  };
}

it('仅主窗口同源主 frame 可以选择目录，插件 iframe 和其他页面被拒绝', async () => {
  const { owner, frame, open, request, picker } = setup();
  for (const invalid of [
    { ...request, sender: {} },
    { ...request, senderFrame: { url } },
    { ...request, senderFrame: null },
  ]) {
    await expect(picker.select(invalid)).rejects.toThrow('当前页面不能选择');
  }
  frame.url = 'https://example.invalid/';
  await expect(picker.select(request)).rejects.toThrow('当前页面不能选择');
  frame.url = url;
  owner.isDestroyed = () => true;
  await expect(picker.select(request)).rejects.toThrow('当前页面不能选择');
  expect(open).not.toHaveBeenCalled();
});

it('仅打开目录选择器；初始路径可省略，取消和异常路径不返回选择', async () => {
  const { open, request, picker } = setup();
  await expect(picker.select(request, directory)).resolves.toBe(directory);
  expect(open).toHaveBeenLastCalledWith({
    title: '选择项目文件夹',
    buttonLabel: '选择文件夹',
    properties: ['openDirectory'],
    defaultPath: directory,
  });
  open.mockResolvedValueOnce({ canceled: true, filePaths: [] });
  await expect(picker.select(request, 'unfinished')).resolves.toBeNull();
  expect(open.mock.lastCall?.[0]).not.toHaveProperty('defaultPath');
  open.mockResolvedValueOnce({ canceled: false, filePaths: ['relative'] });
  await expect(picker.select(request)).resolves.toBeNull();
  await expect(picker.select(request, { properties: ['openFile'] })).rejects.toThrow('参数无效');
});

it('重复请求只打开一次，导航或主 frame 替换后丢弃迟到结果', async () => {
  const { owner, open, request, picker } = setup();
  let resolve!: (result: OpenDialogReturnValue) => void;
  open.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = picker.select(request);
  await expect(picker.select(request)).rejects.toThrow('已有文件夹选择窗口');
  expect(open).toHaveBeenCalledTimes(1);
  picker.invalidate();
  resolve(selected);
  await expect(pending).resolves.toBeNull();
  const later = picker.select(request);
  owner.webContents.mainFrame = { url };
  resolve(selected);
  await expect(later).resolves.toBeNull();
});

it('系统对话框失败不泄露内部信息，随后可以重试', async () => {
  const { open, request, picker } = setup();
  open.mockRejectedValueOnce(new Error('internal details'));
  await expect(picker.select(request)).rejects.toThrow('无法打开文件夹选择窗口，请重试。');
  await expect(picker.select(request)).resolves.toBe(directory);
});
