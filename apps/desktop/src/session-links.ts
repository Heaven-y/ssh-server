import { formatSessionReference, parseSessionReference, sessionReferenceHash } from '@agentdeck/shared/conversation';
import { SESSION_LINK_CHANNEL } from './bridge';
import { desktopRequestAllowed, type DesktopOwner, type DesktopRequest } from './window-access';

type SessionLinkApp = {
  isPackaged: boolean;
  setAsDefaultProtocolClient(protocol: string): boolean;
  on(event: 'second-instance', listener: (event: unknown, argv: string[]) => void): unknown;
  on(event: 'open-url', listener: (event: { preventDefault(): void }, url: string) => void): unknown;
};
type SessionLinkWindow = DesktopOwner & {
  webContents: DesktopOwner['webContents'] & { send(channel: string, reference: string): void };
};
type Receiver = { owner: SessionLinkWindow; url: string; ready: boolean };

/** 桌面入口只认自有协议；旧 HTTP 引用由前端显式解析，不改变外链边界。 */
export function desktopSessionReference(raw: string): string | undefined {
  try {
    if (new URL(raw).protocol !== 'agentdeck:') return undefined;
    return formatSessionReference(parseSessionReference(raw));
  } catch {
    return undefined;
  }
}

function receiverAllowed(receiver: Receiver, request?: DesktopRequest): boolean {
  const { owner, url } = receiver;
  return desktopRequestAllowed(
    owner,
    url,
    request ?? { sender: owner.webContents, senderFrame: owner.webContents.mainFrame },
  );
}

function sameDocument(source: string, target: string): boolean {
  try {
    const from = new URL(source);
    const to = new URL(target);
    from.hash = '';
    to.hash = '';
    return from.href === to.href;
  } catch {
    return false;
  }
}

/** 保留最近一次打开意图，直到当前主窗口的页面订阅完成，避免启动/重载期间丢事件。 */
export function createDesktopSessionLinks(
  app: SessionLinkApp,
  argv: readonly string[],
  focus: () => void,
  options: { portable?: boolean } = {},
) {
  let pending: string | undefined;
  let current: Receiver | undefined;

  function open(raw: string): boolean {
    const reference = desktopSessionReference(raw);
    if (!reference) return false;
    pending = reference;
    if (current?.ready && receiverAllowed(current)) {
      try {
        current.owner.webContents.send(SESSION_LINK_CHANNEL, reference);
        pending = undefined;
      } catch {
        // 窗口销毁与发送可能并发；留给下一次主页面就绪时消费。
        current.ready = false;
      }
    }
    return true;
  }

  function openArguments(args: readonly string[]): void {
    for (const argument of args) open(argument);
  }

  openArguments(argv);
  app.on('second-instance', (_event, args) => {
    openArguments(args);
    focus();
  });
  app.on('open-url', (event, url) => {
    if (!open(url)) return;
    event.preventDefault();
    focus();
  });
  // electron-builder 便携启动器会在退出后删除解包目录，不能注册其中的临时 exe。
  const portable =
    options.portable ?? Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
  if (app.isPackaged && !portable) app.setAsDefaultProtocolClient('agentdeck');

  return {
    open,
    attach(owner: SessionLinkWindow, initialUrl: string) {
      const receiver: Receiver = { owner, url: initialUrl, ready: false };
      current = receiver;
      const url = new URL(initialUrl);
      if (pending) url.hash = sessionReferenceHash(parseSessionReference(pending));
      return {
        url: url.href,
        initial: (request: DesktopRequest): string | undefined => {
          if (current !== receiver || !receiverAllowed(receiver, request))
            throw new Error('当前页面不能打开会话引用。');
          receiver.ready = true;
          const reference = pending;
          pending = undefined;
          return reference;
        },
        open(reference: string, source = owner.webContents.mainFrame.url): boolean {
          if (current !== receiver || !receiverAllowed(receiver)) return false;
          return sameDocument(source, owner.webContents.mainFrame.url) && open(reference);
        },
        invalidate(): void {
          receiver.ready = false;
        },
        detach(): void {
          if (current === receiver) current = undefined;
        },
      };
    },
  };
}
