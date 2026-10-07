import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { TERMINAL_LIMITS, type TerminalTarget, type TerminalServerMessage } from '@ssh-server/shared';
import { createTerminalConnection, type TerminalConnection } from './connection';
import { createTerminalPaste, prepareTerminalPaste } from './paste';
import { useUiPreferences } from '../../ui/ui-preferences';

const TERMINAL_THEMES: Record<'light' | 'dark', ITheme> = {
  dark: { background: '#101114', foreground: '#eeeff3', cursor: '#9cb5ff', selectionBackground: '#303d65' },
  light: {
    background: '#f5f6f8',
    foreground: '#1b2230',
    cursor: '#254dc6',
    selectionBackground: '#cbd6f7',
    black: '#1b2230',
    red: '#a51c34',
    green: '#23613e',
    yellow: '#805100',
    blue: '#254dc6',
    magenta: '#7b358c',
    cyan: '#1a6270',
    white: '#505968',
    brightBlack: '#505968',
    brightRed: '#b6273f',
    brightGreen: '#23613e',
    brightYellow: '#805100',
    brightBlue: '#254dc6',
    brightMagenta: '#7b358c',
    brightCyan: '#1a6270',
    brightWhite: '#1b2230',
  },
};

export type TerminalPaneStatus = {
  phase: 'connecting' | 'ready' | 'paused' | 'exited' | 'error' | 'disconnected';
  message: string;
  startDir?: string;
};
export function createTerminalRuntime(options: {
  host: HTMLElement;
  target: TerminalTarget;
  binding: string;
  status: (status: TerminalPaneStatus) => void;
  paste: (text: string) => void;
  notice: (message: string) => void;
  pending: (pending: boolean) => void;
}) {
  const { host } = options;
  const terminal = new Terminal({
    scrollback: TERMINAL_LIMITS.scrollback,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 13,
    screenReaderMode: true,
    cursorBlink: true,
    disableStdin: true,
    theme: TERMINAL_THEMES[useUiPreferences.getState().theme],
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  // 仅替换 xterm 配色，保留缓冲区、选择、输入状态与现有 PTY。
  const unsubscribeTheme = useUiPreferences.subscribe((state, previous) => {
    if (state.theme !== previous.theme) terminal.options.theme = TERMINAL_THEMES[state.theme];
  });
  let connection: TerminalConnection | undefined;
  let visible = false;
  let composing = false;
  let disposed = false;
  let frame = 0;
  let lastSize = { cols: 80, rows: 24 };
  let current: TerminalPaneStatus = { phase: 'connecting', message: '正在开启终端…' };
  const update = (status: TerminalPaneStatus) => {
    current = status;
    options.status(status);
  };
  const paste = createTerminalPaste({ send: (bytes) => connection?.input(bytes) ?? false, changed: options.pending });
  function availability(available: boolean) {
    terminal.options.disableStdin = !available;
    if (current.phase === 'ready' || current.phase === 'paused')
      update({
        ...current,
        phase: available ? 'ready' : 'paused',
        message: available ? '已连接' : '输入暂停，正在等待发送缓冲恢复',
      });
    if (available) paste.flush();
  }
  function message(value: TerminalServerMessage) {
    if (value.type === 'ready') update({ phase: 'ready', message: '已连接', startDir: value.startDir });
    if (value.type === 'error') {
      paste.cancel(true);
      update({ phase: 'error', message: value.message });
    }
    if (value.type === 'exit') {
      paste.cancel(true);
      update({
        phase: 'exited',
        message: value.outputComplete
          ? `终端已结束（退出码 ${value.exitCode ?? '未知'}${value.signal ? `，信号 ${value.signal}` : ''}）`
          : '终端已结束，输出未完整显示',
      });
    }
  }
  function measure() {
    frame = 0;
    if (disposed || !visible || !host.clientWidth || !host.clientHeight) return;
    try {
      fit.fit();
    } catch {
      terminal.resize(80, 24);
    }
    const size = { cols: Math.max(2, Math.min(500, terminal.cols)), rows: Math.max(2, Math.min(500, terminal.rows)) };
    terminal.resize(size.cols, size.rows);
    if (!connection) {
      connection = createTerminalConnection({
        target: options.target,
        binding: options.binding,
        size,
        callbacks: {
          output: (bytes) =>
            terminal.write(bytes, () => {
              if (!disposed) connection?.ack(bytes.length);
            }),
          message,
          availability,
          closed: () => {
            paste.cancel(true);
            update({ phase: 'disconnected', message: '连接已断开，请新建连接；旧输入不会重发' });
          },
        },
      });
    } else if (size.cols !== lastSize.cols || size.rows !== lastSize.rows) connection.resize(size);
    lastSize = size;
  }
  const schedule = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(measure);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(host);
  const data = terminal.onData((text) => {
    if (!connection?.input(new TextEncoder().encode(text))) options.notice('输入暂不可用，本次按键未发送');
  });
  const binary = terminal.onBinary((text) => {
    if (!connection?.input(Uint8Array.from(text, (char) => char.charCodeAt(0))))
      options.notice('输入暂不可用，本次按键未发送');
  });
  const osc = terminal.parser.registerOscHandler(52, () => true);
  const lifetime = new AbortController();
  host.addEventListener(
    'compositionstart',
    () => {
      composing = true;
    },
    { signal: lifetime.signal },
  );
  host.addEventListener(
    'compositionend',
    () => {
      composing = false;
    },
    { signal: lifetime.signal },
  );
  host.addEventListener(
    'paste',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.paste(event.clipboardData?.getData('text/plain') ?? '');
    },
    { capture: true, signal: lifetime.signal },
  );
  const readClipboard = async () => {
    try {
      options.paste(await navigator.clipboard.readText());
    } catch {
      options.notice('无法读取剪贴板，请在终端使用普通粘贴入口');
    }
  };
  const copy = async () => {
    const text = terminal.getSelection();
    if (!text) {
      options.notice('请先在终端选中文本');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      options.notice('已复制选中文本');
    } catch {
      options.notice('无法写入剪贴板，请使用浏览器的复制入口');
    }
  };
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || composing || event.isComposing || !event.ctrlKey || !event.shiftKey) return true;
    const key = event.key.toLowerCase();
    if (key === 'c') {
      event.preventDefault();
      void copy();
      return false;
    }
    if (key === 'v') {
      event.preventDefault();
      void readClipboard();
      return false;
    }
    return true;
  });
  return {
    setVisible(value: boolean) {
      visible = value;
      if (value) schedule();
    },
    focus: () => terminal.focus(),
    copy,
    readClipboard,
    paste(text: string) {
      try {
        if (!paste.enqueue(prepareTerminalPaste(text), terminal.modes.bracketedPasteMode))
          options.notice('仍有粘贴等待发送，请先等待或取消剩余内容');
      } catch (error) {
        options.notice((error as Error).message);
      }
    },
    cancelPaste() {
      paste.cancel();
      options.notice('已取消尚未发送的粘贴；已发送部分无法撤回');
    },
    dispose() {
      disposed = true;
      unsubscribeTheme();
      lifetime.abort();
      observer.disconnect();
      cancelAnimationFrame(frame);
      paste.cancel(true);
      connection?.close();
      data.dispose();
      binary.dispose();
      osc.dispose();
      terminal.dispose();
    },
  };
}
export type TerminalRuntime = ReturnType<typeof createTerminalRuntime>;
