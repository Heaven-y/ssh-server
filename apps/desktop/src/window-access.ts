import { navigationAllowed } from './paths';

type Frame = { url: string };
export type DesktopOwner = {
  isDestroyed(): boolean;
  webContents: { isDestroyed(): boolean; mainFrame: Frame };
};
export type DesktopRequest = { sender: unknown; senderFrame: Frame | null };

/** 所有桌面 IPC 都只允许当前主窗口、当前主 frame 与初始页面同源。 */
export function desktopRequestAllowed(owner: DesktopOwner, initialUrl: string, request: DesktopRequest): boolean {
  if (owner.isDestroyed() || owner.webContents.isDestroyed()) return false;
  return (
    request.sender === owner.webContents &&
    request.senderFrame === owner.webContents.mainFrame &&
    navigationAllowed(initialUrl, request.senderFrame.url)
  );
}
