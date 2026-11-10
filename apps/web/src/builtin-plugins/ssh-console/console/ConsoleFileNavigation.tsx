import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, Home, Pencil, RefreshCw } from 'lucide-react';
import { buttonClass, inputClass } from '../../../ui/styles';
import { directoryCrumbs } from './file-navigation';
import type { ConsoleFileBrowser } from './use-console-files';

export function ConsoleFileNavigation({ browser, disabled }: { browser: ConsoleFileBrowser; disabled: boolean }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const crumbs = useRef<HTMLElement>(null);
  useEffect(() => {
    if (editing) {
      field.current?.focus();
      field.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (crumbs.current) crumbs.current.scrollLeft = crumbs.current.scrollWidth;
  }, [browser.path]);
  const commit = () => {
    setEditing(false);
    if (input.trim() && input.trim() !== browser.path) browser.navigate(input.trim());
  };
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border p-3">
      <button
        type="button"
        className={`${buttonClass('ghost')} px-2`}
        aria-label="后退目录"
        disabled={disabled || browser.loading || !browser.canBack}
        onClick={() => browser.step(-1)}
      >
        <ArrowLeft aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass('ghost')} px-2`}
        aria-label="前进目录"
        disabled={disabled || browser.loading || !browser.canForward}
        onClick={() => browser.step(1)}
      >
        <ArrowRight aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass('ghost')} px-2`}
        aria-label="上级目录"
        disabled={disabled || !browser.directory}
        onClick={() => browser.navigate(browser.directory!.parentPath)}
      >
        <ArrowUp aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass('ghost')} px-2`}
        aria-label="服务器主目录"
        disabled={disabled}
        onClick={() => browser.navigate('~')}
      >
        <Home aria-hidden className="size-4" />
      </button>
      {editing ? (
        <input
          ref={field}
          aria-label="服务器浏览路径"
          className={`${inputClass} min-w-0 flex-1 font-mono`}
          disabled={disabled}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
            }
          }}
        />
      ) : (
        <nav
          ref={crumbs}
          aria-label="服务器目录层级"
          className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap font-mono text-xs"
        >
          {directoryCrumbs(browser.path).map((crumb, index) => (
            <span key={crumb.path} className="inline-flex items-center">
              {index > 0 && (
                <span aria-hidden className="px-1 text-muted-foreground">
                  ›
                </span>
              )}
              <button
                type="button"
                className="min-h-8 rounded px-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={`前往 ${crumb.path}`}
                aria-current={crumb.path === browser.path ? 'location' : undefined}
                disabled={disabled}
                onClick={() => {
                  if (crumb.path !== browser.path) browser.navigate(crumb.path);
                }}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
      )}
      <button
        type="button"
        className={`${buttonClass('ghost')} px-2`}
        aria-label="编辑服务器路径"
        title={browser.path}
        disabled={disabled}
        onClick={() => {
          setInput(browser.path);
          setEditing(true);
        }}
      >
        <Pencil aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass('ghost')} px-2`}
        aria-label="刷新只读目录"
        disabled={disabled || browser.loading}
        onClick={() => browser.navigate(browser.path, 'refresh')}
      >
        <RefreshCw aria-hidden className="size-4" />
      </button>
    </div>
  );
}
