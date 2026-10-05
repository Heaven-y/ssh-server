import { X } from 'lucide-react';
import { useChat } from '../chat/chat-store';
import { buttonClass } from '../../ui/styles';

export function PendingFeedback() {
  const feedback = useChat((state) => state.feedback);
  const remove = useChat((state) => state.removeFeedback);
  if (!feedback.length) return null;
  return (
    <section aria-label="待发送行内反馈" className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-xs font-medium">待发送行内反馈 · {feedback.length}/20</p>
      <ul className="max-h-40 space-y-2 overflow-auto">
        {feedback.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-xs leading-5">
            <div className="min-w-0 flex-1">
              <p className="wrap-anywhere font-mono">
                {item.path} · {item.side === 'old' ? '旧侧' : '新侧'}:{item.line}
              </p>
              <p className="text-muted-foreground">{item.source.label}</p>
              <p className="whitespace-pre-wrap wrap-anywhere">{item.comment}</p>
            </div>
            <button
              type="button"
              className={`${buttonClass('ghost')} shrink-0`}
              aria-label={`移除${item.path}第${item.line}行反馈`}
              onClick={() => remove(item.id)}
            >
              <X aria-hidden className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">点击发送后与消息正文一起发送；不会自动发送。</p>
    </section>
  );
}
