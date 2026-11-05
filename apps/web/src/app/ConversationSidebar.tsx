import { useEffect } from 'react';
import { Info, Settings2, X } from 'lucide-react';
import type { Workspace } from '@agentdeck/shared';
import { useChat } from '../features/chat/chat-store';
import { AGENT_LABELS } from '../features/chat/AgentControls';
import { buttonClass } from '../ui/styles';

/** 右侧按需呈现当前会话上下文；不连接服务器，也不扫描项目文件。 */
export function ConversationSidebar({
  workspace,
  open,
  close,
  settings,
}: {
  workspace?: Workspace;
  open: boolean;
  close(): void;
  settings(): void;
}) {
  const agent = useChat((state) => state.agent);
  const sessionId = useChat((state) => state.sessionId);
  const model = useChat((state) => state.modelOverrides[state.agent]);
  const effort = useChat((state) => state.reasoningEfforts[state.agent]);
  const running = useChat((state) => state.running || !!state.pendingClientTurnId);
  useEffect(() => {
    if (open || !document.activeElement?.closest('#conversation-sidebar')) return;
    document.querySelector<HTMLButtonElement>('button[aria-controls="conversation-sidebar"]')?.focus();
  }, [open]);
  return (
    <aside
      id="conversation-sidebar"
      aria-label="右侧边栏"
      className="flex h-full min-h-0 flex-col bg-background"
      onKeyDown={(event) => {
        if (
          event.key !== 'Escape' ||
          event.defaultPrevented ||
          (event.target instanceof Element && event.target.closest('dialog,[role="dialog"]'))
        )
          return;
        event.preventDefault();
        close();
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Info aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="flex-1 text-sm font-medium">会话信息</h2>
        <button
          type="button"
          aria-label="收起右侧边栏"
          onClick={close}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>
      <div className="min-h-0 space-y-6 overflow-auto p-5 text-sm">
        {workspace ? (
          <>
            <dl className="space-y-5">
              <Field label="工作区" value={workspace.name} />
              <Field label="本地目录" value={workspace.dir} mono />
              <Field label="CLI" value={AGENT_LABELS[agent]} />
              <Field label="原生会话" value={sessionId || '发送第一条消息后创建'} mono={!!sessionId} />
              <Field label="模型设置" value={model || '使用 CLI 原生默认'} />
              <Field label="推理强度" value={effort || '使用 CLI 原生默认'} />
              <Field label="状态" value={running ? '正在运行' : '空闲'} />
            </dl>
            <button type="button" className={buttonClass('outline')} onClick={settings}>
              <Settings2 aria-hidden className="size-4" />
              打开配置
            </button>
          </>
        ) : (
          <p className="leading-6 text-muted-foreground">选择一个工作区或会话，查看当前上下文。</p>
        )}
      </div>
    </aside>
  );
}
function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="mb-1.5 text-xs text-muted-foreground">{label}</dt>
      <dd className={`break-words leading-6 ${mono ? 'font-mono text-xs [overflow-wrap:anywhere]' : ''}`}>{value}</dd>
    </div>
  );
}
