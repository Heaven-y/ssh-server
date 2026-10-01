import { ShieldAlert } from 'lucide-react';
import { buttonClass } from '../../ui/styles';
import type { ChatItem } from './chat-reducer';
import { useChat } from './chat-store';
import { shortToolName } from './ToolCard';

type PermissionItem = Extract<ChatItem, { kind: 'permission' }>;

/** 权限请求：Agent 要执行不在自动允许范围内的操作（如本地 Bash），等待用户批准或拒绝 */
export function PermissionCard({ item }: { item: PermissionItem }) {
  const respond = useChat((s) => s.respondPermission);
  const name = shortToolName(item.toolName);

  return (
    <div role="group" aria-label={`权限请求：${name}`} className="rounded-md border border-border-strong bg-card p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <ShieldAlert aria-hidden className="size-4 text-accent" />
        需要确认：{name}
      </div>
      {item.description && <p className="mt-1 text-muted-foreground">{item.description}</p>}
      <pre className="mt-2 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-xs whitespace-pre-wrap">
        {JSON.stringify(item.input, null, 2)}
      </pre>
      {item.resolved ? (
        <p className="mt-2 text-muted-foreground">{item.resolved === 'allow' ? '已批准' : '已拒绝'}</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button type="button" className={buttonClass('primary')} onClick={() => respond(item.id, true)}>
            批准
          </button>
          <button type="button" className={buttonClass('danger')} onClick={() => respond(item.id, false)}>
            拒绝
          </button>
        </div>
      )}
    </div>
  );
}
