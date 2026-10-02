import CodeMirror, { EditorView, Prec } from '@uiw/react-codemirror';
import { useCallback, useMemo } from 'react';
import { json } from '@codemirror/lang-json';
import { StreamLanguage } from '@codemirror/language';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { python } from '@codemirror/legacy-modes/mode/python';
import { javascript, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { markdown } from '@codemirror/lang-markdown';

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--color-background)', color: 'var(--color-foreground)' },
    '.cm-gutters': { backgroundColor: 'var(--color-card)', color: 'var(--color-muted-foreground)', border: 'none' },
    '.cm-content': { fontFamily: 'var(--font-mono)', fontSize: '13px' },
    '.cm-scroller': { overflow: 'auto' },
    '&.cm-focused': { outline: '2px solid var(--color-accent)', outlineOffset: '-2px' },
  },
  { dark: true },
);
const extensions = {
  json: [json()],
  toml: [StreamLanguage.define(toml)],
  python: [StreamLanguage.define(python)],
  javascript: [StreamLanguage.define(javascript)],
  typescript: [StreamLanguage.define(typescript)],
  shell: [StreamLanguage.define(shell)],
  yaml: [StreamLanguage.define(yaml)],
  markdown: [markdown()],
  text: [],
};
export type CodeFormat = keyof typeof extensions;
const basicSetup = { foldGutter: true, highlightActiveLine: true, autocompletion: false };

/** 仅保存当前组件的编辑状态；不序列化撤销历史，不连接浏览器持久存储。 */
export function CodeEditor({
  value,
  format,
  disabled,
  lineSeparator = '\n',
  label = '配置文件内容',
  height = 'min(42vh, 440px)',
  onChange,
}: {
  value: string;
  format: CodeFormat;
  disabled: boolean;
  lineSeparator?: '\n' | '\r\n';
  label?: string;
  height?: string;
  onChange(value: string): void;
}) {
  const configured = useMemo(
    () => [
      ...extensions[format],
      Prec.high(theme),
      EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', 'data-gramm': 'false' }),
    ],
    [format, label],
  );
  const changed = useCallback(
    (text: string) => onChange(lineSeparator === '\r\n' ? text.replace(/\n/g, '\r\n') : text),
    [lineSeparator, onChange],
  );
  return (
    <CodeMirror
      value={value.replace(/\r\n/g, '\n')}
      theme="dark"
      extensions={configured}
      height={height}
      style={height === '100%' ? { height: '100%' } : undefined}
      minHeight="220px"
      readOnly={disabled}
      editable={!disabled}
      indentWithTab={false}
      basicSetup={basicSetup}
      // 编辑器内部保持 LF，写回沿用原行尾；避免 wrapper 反复替换整份内容和光标。
      onChange={changed}
    />
  );
}
