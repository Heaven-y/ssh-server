import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { ChatItem } from './chat-reducer';
import { useChat } from './chat-store';
import { toolDisplayName } from './tool-presentation';

function currentActivity(items: ChatItem[]) {
  const current = items.slice(items.findLastIndex((item) => item.kind === 'user') + 1);
  if (current.some((item) => item.kind === 'permission' && !item.resolved)) return '等待批准…';
  const tool = current.findLast((item) => item.kind === 'tool' && item.status === 'running');
  if (tool?.kind === 'tool') return `正在${toolDisplayName(tool.name)}…`;
  const activity = current.findLast((item) => item.kind === 'activity' && item.status === 'running');
  if (activity?.kind === 'activity') return activity.name;
  return replyStatus(current);
}

function replyStatus(current: ChatItem[]) {
  if (current.some((item) => item.kind === 'compaction' && item.state.status === 'running')) return '正在压缩上下文…';
  const last = current.findLast((item) => item.kind !== 'statistics');
  if (last?.kind === 'assistant' && last.streaming) return '正在生成回复…';
  if (last?.kind === 'reasoning') return '正在思考…';
  return '正在处理，等待模型响应…';
}

function Elapsed({ start }: { start: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return (
    <span aria-hidden className="shrink-0 tabular-nums">
      {seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`}
    </span>
  );
}

/** 无文本事件时仍展示请求进度；不生成 CLI 未提供的思考正文。 */
export function RunStatus() {
  const running = useChat((state) => state.running);
  const pending = useChat((state) => state.pendingClientTurnId);
  const stopping = useChat((state) => state.interruptRequested);
  const items = useChat((state) => state.items);
  const started = useChat((state) => state.lastSentAt);
  const connection = useChat((state) => state.connection);
  if (!running && !pending) return null;
  const label = stopping ? '正在停止…' : pending ? '正在准备会话…' : currentActivity(items);
  return (
    <div
      role="status"
      aria-label="本轮运行状态"
      className="conversation-notice flex shrink-0 items-center gap-2 py-2 text-xs text-muted-foreground"
    >
      <LoaderCircle aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin" />
      <span className="min-w-0 flex-1 truncate" title={label}>
        {label}
      </span>
      {connection !== 'open' && <span>正在重新连接…</span>}
      {started !== undefined && <Elapsed key={started} start={started} />}
    </div>
  );
}
