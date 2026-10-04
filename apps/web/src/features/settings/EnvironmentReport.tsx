import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { EnvironmentReport as Report } from '@ssh-server/shared';
import { api } from '../../lib/api';
import { buttonClass } from '../../ui/styles';

export function EnvironmentReport({ disabled }: { disabled: boolean }) {
  const pending = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState('');
  useEffect(() => () => pending.current?.abort(), []);
  const check = async () => {
    if (pending.current || disabled) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await api.detectEnvironment(controller.signal);
      if (!controller.signal.aborted) setReport(result);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '环境检测失败，请重试。');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (pending.current === controller) pending.current = undefined;
    }
  };
  return (
    <section className="space-y-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">本机运行环境</h3>
        <button
          type="button"
          className={buttonClass('outline')}
          disabled={busy || disabled}
          onClick={() => void check()}
        >
          <RefreshCw aria-hidden className={`size-4 ${busy ? 'motion-safe:animate-spin' : ''}`} />
          {busy ? '正在检测…' : '检测环境'}
        </button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        只检查现有工具版本，每项最多5秒；不安装软件、不连接SSH、不调用模型。
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {report && (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            检测时间：{new Date(report.checkedAt).toLocaleString('zh-CN')}
          </p>
          <ul className="space-y-2 text-sm">
            {report.tools.map((tool) => (
              <li key={tool.name} className="rounded border border-border p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>{tool.name}</span>
                  <span className={tool.available ? 'text-success' : 'text-warning'}>
                    {tool.available ? `可用 · ${tool.version}` : '未确认可用'}
                  </span>
                </div>
                {tool.message && <p className="mt-1 text-xs leading-5 text-muted-foreground">{tool.message}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
