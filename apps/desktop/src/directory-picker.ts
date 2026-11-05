import path from 'node:path';
import type { OpenDialogOptions, OpenDialogReturnValue } from 'electron';
import { navigationAllowed } from './paths';

type Frame = { url: string };
type Owner = {
  isDestroyed(): boolean;
  webContents: { isDestroyed(): boolean; mainFrame: Frame };
};
type Request = { sender: unknown; senderFrame: Frame | null };
type OpenDirectory = (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;

function authorized(owner: Owner, initialUrl: string, request: Request): boolean {
  if (owner.isDestroyed() || owner.webContents.isDestroyed()) return false;
  return (
    request.sender === owner.webContents &&
    request.senderFrame === owner.webContents.mainFrame &&
    navigationAllowed(initialUrl, request.senderFrame.url)
  );
}

function initialDirectory(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'string' || input.length > 32_767 || input.includes('\0'))
    throw new Error('目录选择参数无效，请重新输入。');
  const value = input.trim();
  // 输入尚未完成时从系统默认目录打开，避免要求用户先手填一个完整路径。
  return path.isAbsolute(value) ? value : undefined;
}

/** 限定为当前主页面；插件 iframe、其他窗口及导航前的请求不能取得本机路径。 */
export function createDirectoryPicker(owner: Owner, initialUrl: string, open: OpenDirectory) {
  let pending = false;
  let generation = 0;
  const invalidate = () => {
    generation += 1;
  };
  const select = async (request: Request, input?: unknown): Promise<string | null> => {
    if (!authorized(owner, initialUrl, request)) throw new Error('当前页面不能选择本机文件夹。');
    if (pending) throw new Error('已有文件夹选择窗口，请先完成当前选择。');
    const defaultPath = initialDirectory(input);
    const current = generation;
    pending = true;
    try {
      const result = await open({
        title: '选择项目文件夹',
        buttonLabel: '选择文件夹',
        properties: ['openDirectory'],
        ...(defaultPath ? { defaultPath } : {}),
      });
      if (current !== generation || !authorized(owner, initialUrl, request)) return null;
      const selected = result.filePaths[0];
      return !result.canceled && selected && path.isAbsolute(selected) ? selected : null;
    } catch {
      throw new Error('无法打开文件夹选择窗口，请重试。');
    } finally {
      pending = false;
    }
  };
  return { select, invalidate };
}
