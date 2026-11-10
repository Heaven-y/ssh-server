import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useUiPreferences } from '../../../ui/ui-preferences';
import { prepareTerminalPaste } from '../legacy/terminal/paste';
import { createConsoleTerminalConnection } from './terminal-connection';
import { countTerminalMatches, terminalSearchDecorations, type TerminalSearchResults } from './terminal-search';

const themes: Record<'light' | 'dark', ITheme> = {
  dark: { background: '#101114', foreground: '#eeeff3', cursor: '#9cb5ff', selectionBackground: '#303d65' },
  light: {
    background: '#f5f6f8',
    foreground: '#1b2230',
    cursor: '#254dc6',
    selectionBackground: '#cbd6f7',
    black: '#1b2230',
    white: '#505968',
    brightWhite: '#1b2230',
  },
};
export function createConsoleTerminalRuntime(options: {
  host: HTMLElement;
  serverId: string;
  terminalId: string;
  status(message: string): void;
  paste(text: string): void;
  searchResults?(results: TerminalSearchResults | null): void;
}) {
  const terminal = new Terminal({
    scrollback: 5000,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 13,
    screenReaderMode: true,
    cursorBlink: true,
    disableStdin: true,
    allowProposedApi: true,
    theme: themes[useUiPreferences.getState().theme],
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  let searchQuery = '';
  terminal.loadAddon(fit);
  terminal.loadAddon(search);
  terminal.open(options.host);
  const searchEvents = search.onDidChangeResults(() => {
    if (searchQuery)
      options.searchResults?.(
        countTerminalMatches(terminal.buffer.active, searchQuery, terminal.getSelectionPosition()),
      );
  });
  let visible = false;
  let disposed = false;
  let frame = 0;
  let lastSize = '';
  const connection = createConsoleTerminalConnection({
    serverId: options.serverId,
    terminalId: options.terminalId,
    output: (bytes, reset) =>
      new Promise<void>((resolve) => {
        if (reset) terminal.reset();
        if (!bytes.length) resolve();
        else terminal.write(bytes, resolve);
      }),
    state: (state) =>
      options.status(
        state.exited
          ? `终端已结束（退出码 ${state.exitCode ?? '未知'}）`
          : state.inputPaused
            ? '输入暂时暂停'
            : `已连接 · ${state.startDir}`,
      ),
    error: options.status,
    availability: (ready) => {
      terminal.options.disableStdin = !ready;
    },
  });
  const theme = useUiPreferences.subscribe((state, previous) => {
    if (state.theme === previous.theme) return;
    terminal.options.theme = themes[state.theme];
    if (searchQuery) {
      search.clearDecorations();
      search.findNext(searchQuery, {
        incremental: true,
        decorations: terminalSearchDecorations(state.theme === 'dark'),
      });
    }
  });
  function measure() {
    frame = 0;
    if (!visible || disposed || !options.host.clientWidth || !options.host.clientHeight) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    const size = { cols: Math.max(2, Math.min(500, terminal.cols)), rows: Math.max(2, Math.min(500, terminal.rows)) };
    const key = JSON.stringify(size);
    if (key !== lastSize) {
      lastSize = key;
      connection.resize(size);
    }
  }
  const schedule = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(measure);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(options.host);
  const data = terminal.onData((text) => {
    if (!connection.input(new TextEncoder().encode(text))) options.status('输入暂不可用，本次按键未发送。');
  });
  const binary = terminal.onBinary((text) => {
    if (!connection.input(Uint8Array.from(text, (character) => character.charCodeAt(0))))
      options.status('输入暂不可用。');
  });
  const osc = terminal.parser.registerOscHandler(52, () => true);
  const lifetime = new AbortController();
  options.host.addEventListener(
    'paste',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.paste(event.clipboardData?.getData('text/plain') ?? '');
    },
    { capture: true, signal: lifetime.signal },
  );
  return {
    setVisible(value: boolean) {
      visible = value;
      connection.setVisible(value);
      if (value) schedule();
    },
    focus: () => terminal.focus(),
    search(text: string, backwards = false, incremental = false) {
      searchQuery = text;
      if (!text) {
        search.clearDecorations();
        terminal.clearSelection();
        options.searchResults?.(null);
        return false;
      }
      const searchOptions = {
        incremental,
        decorations: terminalSearchDecorations(useUiPreferences.getState().theme === 'dark'),
      };
      return backwards ? search.findPrevious(text, searchOptions) : search.findNext(text, searchOptions);
    },
    async copy() {
      try {
        const text = terminal.getSelection();
        if (text) await navigator.clipboard.writeText(text);
        else options.status('请先选中终端文本。');
      } catch {
        options.status('无法写入剪贴板。');
      }
    },
    async readClipboard() {
      try {
        options.paste(await navigator.clipboard.readText());
      } catch {
        options.status('无法读取剪贴板，请使用终端粘贴。');
      }
    },
    paste(text: string) {
      try {
        const bytes = prepareTerminalPaste(text);
        const payload = terminal.modes.bracketedPasteMode
          ? new TextEncoder().encode(`\x1b[200~${text}\x1b[201~`)
          : bytes;
        if (!connection.input(payload)) options.status('输入暂不可用，本次粘贴未发送。');
      } catch (reason) {
        options.status((reason as Error).message);
      }
    },
    dispose() {
      disposed = true;
      theme();
      lifetime.abort();
      observer.disconnect();
      cancelAnimationFrame(frame);
      connection.dispose();
      data.dispose();
      binary.dispose();
      osc.dispose();
      searchEvents.dispose();
      terminal.dispose();
    },
  };
}
