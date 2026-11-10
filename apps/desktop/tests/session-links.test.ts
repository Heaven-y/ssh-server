import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createDesktopSessionLinks, desktopSessionReference } from '../src/session-links';

const rendererUrl = 'http://localhost/';
const first = 'agentdeck://session?workspace=demo&agent=codex&id=first';
const second = 'agentdeck://session?workspace=demo&agent=claude&id=second';

afterEach(() => vi.unstubAllEnvs());

class AppStub extends EventEmitter {
  isPackaged = false;
  setAsDefaultProtocolClient = vi.fn(() => true);
}

function windowStub(url = rendererUrl) {
  const frame = { url };
  const webContents = { isDestroyed: () => false, mainFrame: frame, send: vi.fn() };
  const owner = { isDestroyed: () => false, webContents };
  return { owner, frame, request: { sender: webContents, senderFrame: frame } };
}

it('安装版注册协议，开发启动不改变系统默认协议', () => {
  const development = new AppStub();
  createDesktopSessionLinks(development, [], vi.fn());
  expect(development.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  const packaged = new AppStub();
  packaged.isPackaged = true;
  createDesktopSessionLinks(packaged, [], vi.fn(), { portable: false });
  expect(packaged.setAsDefaultProtocolClient).toHaveBeenCalledWith('agentdeck');
});

it('便携版不注册临时程序协议，初始引用和页面内部跳转仍正常', () => {
  const app = new AppStub();
  app.isPackaged = true;
  const links = createDesktopSessionLinks(app, [first], vi.fn(), { portable: true });
  const { owner, request } = windowStub();
  const binding = links.attach(owner, rendererUrl);
  expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  expect(binding.initial(request)).toBe(first);
  expect(binding.open(second, rendererUrl)).toBe(true);
  expect(owner.webContents.send).toHaveBeenCalledWith('agentdeck:session-link', second);
});

it.each(['PORTABLE_EXECUTABLE_FILE', 'PORTABLE_EXECUTABLE_DIR'])('从 electron-builder 的 %s 识别便携版', (name) => {
  vi.stubEnv('PORTABLE_EXECUTABLE_FILE', undefined);
  vi.stubEnv('PORTABLE_EXECUTABLE_DIR', undefined);
  vi.stubEnv(name, 'portable');
  const app = new AppStub();
  app.isPackaged = true;
  createDesktopSessionLinks(app, [], vi.fn());
  expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
});

it('首次启动引用进入窗口 hash，并保留到当前窗口主 frame 就绪', () => {
  const links = createDesktopSessionLinks(new AppStub(), ['executable', '--flag', first], vi.fn());
  const { owner, request } = windowStub();
  const binding = links.attach(owner, rendererUrl);
  expect(binding.url).toBe('http://localhost/#session?workspace=demo&agent=codex&id=first');
  expect(owner.webContents.send).not.toHaveBeenCalled();
  expect(binding.initial(request)).toBe(first);
  expect(binding.initial(request)).toBeUndefined();
});

it('启动与页面加载期间的 second-instance 不丢失，页面就绪后直接推送新引用', () => {
  const app = new AppStub();
  const focus = vi.fn();
  const links = createDesktopSessionLinks(app, [], focus);
  app.emit('second-instance', {}, ['executable', first]);
  const { owner, request } = windowStub();
  const binding = links.attach(owner, rendererUrl);
  app.emit('second-instance', {}, ['executable', second]);
  expect(binding.initial(request)).toBe(second);
  app.emit('second-instance', {}, ['executable', first]);
  expect(owner.webContents.send).toHaveBeenLastCalledWith('agentdeck:session-link', first);
  binding.invalidate();
  app.emit('second-instance', {}, ['executable', second]);
  expect(owner.webContents.send).toHaveBeenCalledTimes(1);
  expect(binding.initial(request)).toBe(second);
  expect(focus).toHaveBeenCalledTimes(4);
});

it('macOS open-url 在窗口创建前保留引用，错误链接不改变待打开目标', () => {
  const app = new AppStub();
  const focus = vi.fn();
  const links = createDesktopSessionLinks(app, [], focus);
  const event = { preventDefault: vi.fn() };
  app.emit('open-url', event, first);
  app.emit('open-url', event, 'https://example.invalid/#session?workspace=demo&agent=codex&id=other');
  const { owner, request } = windowStub();
  expect(links.attach(owner, rendererUrl).initial(request)).toBe(first);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(focus).toHaveBeenCalledTimes(1);
});

it('旧窗口、子 frame、跨源页面和已关闭窗口不能消费或接收待打开引用', () => {
  const links = createDesktopSessionLinks(new AppStub(), [first], vi.fn());
  const old = windowStub();
  const oldBinding = links.attach(old.owner, rendererUrl);
  const current = windowStub();
  const binding = links.attach(current.owner, rendererUrl);
  expect(() => oldBinding.initial(old.request)).toThrow('当前页面不能打开会话引用');
  for (const request of [
    { ...current.request, sender: old.owner.webContents },
    { ...current.request, senderFrame: { url: rendererUrl } },
    { ...current.request, senderFrame: null },
  ]) {
    expect(() => binding.initial(request)).toThrow('当前页面不能打开会话引用');
  }
  current.frame.url = 'https://example.invalid/';
  expect(() => binding.initial(current.request)).toThrow('当前页面不能打开会话引用');
  current.frame.url = rendererUrl;
  expect(binding.initial(current.request)).toBe(first);
  current.owner.isDestroyed = () => true;
  expect(links.open(second)).toBe(true);
  expect(current.owner.webContents.send).not.toHaveBeenCalled();
  const replacement = windowStub();
  const replacementBinding = links.attach(replacement.owner, rendererUrl);
  oldBinding.detach();
  expect(replacementBinding.initial(replacement.request)).toBe(second);
});

it('窗口内仅当前主页面可转发会话链接，外部和插件来源仍被拒绝', () => {
  const links = createDesktopSessionLinks(new AppStub(), [], vi.fn());
  const current = windowStub();
  const binding = links.attach(current.owner, rendererUrl);
  binding.initial(current.request);
  expect(binding.open(first, 'https://example.invalid/')).toBe(false);
  expect(binding.open(first, `${rendererUrl}plugin`)).toBe(false);
  expect(binding.open(first, rendererUrl)).toBe(true);
  expect(current.owner.webContents.send).toHaveBeenCalledWith('agentdeck:session-link', first);
  current.frame.url = 'https://example.invalid/';
  expect(binding.open(second, current.frame.url)).toBe(false);
});

it.each([
  'https://example.invalid/#session?workspace=demo&agent=codex&id=first',
  'javascript:alert(1)',
  'file:///session',
  'agentdeck://other?workspace=demo&agent=codex&id=first',
  'agentdeck://session/path?workspace=demo&agent=codex&id=first',
  'agentdeck://user@session?workspace=demo&agent=codex&id=first',
  'agentdeck://session:80?workspace=demo&agent=codex&id=first',
  `${first}#extra`,
  `${first}&id=duplicate`,
  `${first}&extra=value`,
  'agentdeck://session?workspace=demo&agent=unknown&id=first',
  'agentdeck://session?workspace=demo&agent=codex',
  'agentdeck://session?workspace=&agent=codex&id=first',
])('拒绝不符合桌面会话 URI 的输入：%s', (reference) => {
  expect(desktopSessionReference(reference)).toBeUndefined();
});
