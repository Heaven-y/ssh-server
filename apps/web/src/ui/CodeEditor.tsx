import CodeMirror, { EditorView, Prec } from '@uiw/react-codemirror';
import { useCallback } from 'react';
import { json } from '@codemirror/lang-json';
import { StreamLanguage } from '@codemirror/language';
import { toml } from '@codemirror/legacy-modes/mode/toml';

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
const accessible = EditorView.contentAttributes.of({
  'aria-label': '配置文件内容',
  spellcheck: 'false',
  'data-gramm': 'false',
});

const extensions = {
  json: [json(), Prec.high(theme), accessible],
  toml: [StreamLanguage.define(toml), Prec.high(theme), accessible],
};
const basicSetup = { foldGutter: true, highlightActiveLine: true, autocompletion: false };

/** 仅保存当前组件的编辑状态；不序列化撤销历史，不连接浏览器持久存储。 */
export function CodeEditor({
  value,
  format,
  disabled,
  lineSeparator = '\n',
  onChange,
}: {
  value: string;
  format: 'json' | 'toml';
  disabled: boolean;
  lineSeparator?: '\n' | '\r\n';
  onChange(value: string): void;
}) {
  const changed = useCallback(
    (text: string) => onChange(lineSeparator === '\r\n' ? text.replace(/\n/g, '\r\n') : text),
    [lineSeparator, onChange],
  );
  return (
    <CodeMirror
      value={value.replace(/\r\n/g, '\n')}
      theme="dark"
      extensions={extensions[format]}
      height="min(42vh, 440px)"
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
