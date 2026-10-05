import type { AgentKind } from '@ssh-server/shared';

export type ConversationScope = { workspaceId: string; agent: AgentKind; conversationVersion: number };
export type FeedbackSource = { kind: 'turn' | 'working'; id: string; label: string };
export type LineFeedbackInput = {
  path: string;
  side: 'old' | 'new';
  line: number;
  source: FeedbackSource;
  comment: string;
};
export type LineFeedback = LineFeedbackInput & { id: string };
export type ChangesRequest = ConversationScope & { nonce: string; turnId?: string };

export function feedbackError(items: LineFeedback[], input: LineFeedbackInput): string | undefined {
  if (
    !input.path ||
    input.path.length > 4096 ||
    /\p{Cc}/u.test(input.path) ||
    !Number.isSafeInteger(input.line) ||
    input.line < 1
  )
    return '请选择差异中的有效文件和行号';
  const length = input.comment.trim().length;
  if (!length || length > 3000) return '反馈需为1–3000个字符';
  if (items.length >= 20) return '待发送反馈最多20条，请先发送或移除部分反馈';
  if (items.reduce((count, item) => count + item.comment.length, 0) + length > 12000)
    return '待发送反馈总量不能超过12000个字符';
  return undefined;
}

export function messageWithFeedback(text: string, items: LineFeedback[]): string {
  if (!items.length) return text;
  const comments = items
    .map((item, index) =>
      [
        `${index + 1}. 文件：${JSON.stringify(item.path)} · ${item.side === 'old' ? '旧侧' : '新侧'}第${item.line}行`,
        `比较来源：${item.source.label}（${item.source.id}）`,
        item.comment,
      ].join('\n'),
    )
    .join('\n\n');
  return [text, `行内反馈：\n${comments}`].filter((part) => part.trim()).join('\n\n');
}
