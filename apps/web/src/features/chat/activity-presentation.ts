import type { ChatItem } from './chat-reducer';
export type ActivityItem = Extract<ChatItem, { kind: 'activity' }>;
const labels = { running: '进行中', completed: '完成', failed: '失败', cancelled: '已取消', unknown: '状态未知' };

export function activityStatus(item: ActivityItem): string {
  return item.incomplete ? '未完成' : labels[item.status];
}
