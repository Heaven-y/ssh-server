import { ShieldAlert } from 'lucide-react';
import { buttonClass } from '../../ui/styles';
import type { ChatItem } from './chat-reducer';
import { useChat } from './chat-store';
import { shortToolName } from './ToolCard';

type PermissionItem = Extract<ChatItem, { kind: 'permission' }>;
const RESOLVED_LABELS = { allow: '已批准', deny: '已拒绝', cancelled: '已结束或取消' } as const;

/** 权限请求：Agent 要执行不在自动允许范围内的操作（如本地 Bash），等待用户批准或拒绝 */
export function PermissionCard({ item }: { item: PermissionItem }) {
  const respond = useChat((s) => s.respondPermission);
  const active = useChat((s) => s.running && s.connection === 'open' && !!s.turnId && !s.interruptRequested);
  const name = shortToolName(item.toolName);

  return (
    <div
      role="group"
      aria-label={`权限请求：${name}`}
      className={`min-w-0 rounded-r-lg border-l-2 bg-card/70 px-4 py-3 text-sm ${item.resolved ? 'border-border' : 'border-warning'}`}
    >
      <div className="flex items-center gap-2 font-medium">
        <ShieldAlert
          aria-hidden
          className={`size-4 shrink-0 ${item.resolved ? 'text-muted-foreground' : 'text-warning'}`}
        />
        <span className="min-w-0 break-words">
          {item.resolved ? '权限请求' : '需要确认'}：{name}
        </span>
      </div>
      {item.description && <p className="mt-2 leading-6 break-words text-muted-foreground">{item.description}</p>}
      <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-6 whitespace-pre-wrap break-words">
        {JSON.stringify(item.input, null, 2)}
      </pre>
      {item.resolved ? (
        <p className={`mt-3 text-xs ${item.resolved === 'allow' ? 'text-success' : 'text-muted-foreground'}`}>
          {RESOLVED_LABELS[item.resolved]}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {item.responding && (
            <span role="status" className="mr-auto text-xs text-muted-foreground">
              等待后端确认…
            </span>
          )}
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={!active || item.responding}
            onClick={() => respond(item.id, true)}
          >
            批准
          </button>
          <button
            type="button"
            className={buttonClass('danger')}
            disabled={!active || item.responding}
            onClick={() => respond(item.id, false)}
          >
            拒绝
          </button>
        </div>
      )}
    </div>
  );
}
