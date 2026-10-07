import { useEffect, useState, type ReactNode } from 'react';
import { buttonClass } from '../ui/styles';

/** 授权前不挂载业务组件，也不启动 WebSocket；秘密只由 HttpOnly Cookie 承载。 */
export function LocalSessionGate({ start, mountApp }: { start(): void; mountApp(): ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'pending' | 'ready' | 'error'>('pending');
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    let active = true;
    void fetch('/api/local-session', {
      method: 'POST',
      body: '{}',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('本机会话建立失败');
        if (!active) return;
        start();
        setPhase('ready');
      })
      .catch(() => {
        if (active) setPhase('error');
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [attempt, start]);
  if (phase === 'ready') return mountApp();
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <section className="max-w-md space-y-4 rounded-xl border border-border bg-card p-6">
        <h1 className="text-lg font-semibold">ssh-server</h1>
        {phase === 'pending' ? (
          <p role="status">正在连接本机服务…</p>
        ) : (
          <>
            <p role="alert" className="text-sm leading-6">
              无法建立本机会话。请确认本机后端正在运行，并从本机访问页面。
            </p>
            <button
              type="button"
              className={buttonClass('primary')}
              onClick={() => {
                setPhase('pending');
                setAttempt((value) => value + 1);
              }}
            >
              重试连接
            </button>
          </>
        )}
      </section>
    </main>
  );
}
