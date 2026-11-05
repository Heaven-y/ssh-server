import type { SessionRef } from '@agentdeck/shared';
import { sessionActionKey, useChat } from './chat-store';

/** 仅消费原生报告；来源与模型分开，输入框选择值不参与展示。 */
/** 列表行与原生历史都只提供身份；模型元数据能带就带，缺失时回落到本页观测值。 */
export function useSessionModel(workspaceId: string, session: SessionRef & { nativeModel?: string }) {
  const observed = useChat((state) => state.sessionModels[sessionActionKey(workspaceId, session)]);
  const actual = observed?.actualModel;
  const native = session.nativeModel?.trim() || observed?.nativeModel;
  if (actual) return { model: actual, description: `实际模型：${actual}` };
  if (native) return { model: native, description: `会话模型：${native}` };
  return { model: undefined, description: '模型未报告' };
}
