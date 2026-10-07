import type { SessionSummary } from '@ssh-server/shared';
import { sessionActionKey, useChat } from './chat-store';

/** 仅消费原生报告；来源与模型分开，输入框选择值不参与展示。 */
export function useSessionModel(workspaceId: string, session: SessionSummary) {
  const observed = useChat((state) => state.sessionModels[sessionActionKey(workspaceId, session)]);
  const actual = observed?.actualModel;
  const native = session.nativeModel?.trim() || observed?.nativeModel;
  if (actual) return { model: actual, description: `最近报告的实际模型：${actual}` };
  if (native) return { model: native, description: `原生会话模型：${native}（非逐轮执行报告）` };
  return { model: undefined, description: '模型未报告；原生列表未提供，读取历史或运行后如有报告将更新' };
}
