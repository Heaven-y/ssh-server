import type { PermissionSelection } from '@agentdeck/shared/conversation';
import type { CodexClient } from './client';
import type { AgentTurnInput } from '../contracts';
import { CodexError, record, text, type RecordValue } from './types';

/** 自动审查由 Codex 执行；不在工作台审批回调中代答。 */
export function codexPermissionParams(selection?: PermissionSelection) {
  if (selection?.agent !== 'codex' || selection.mode === 'native') return {};
  const full = selection.mode === 'full-access';
  return {
    sandbox: full ? 'danger-full-access' : 'workspace-write',
    approvalPolicy: full ? 'never' : 'on-request',
    approvalsReviewer: selection.mode === 'auto-review' ? 'auto_review' : 'user',
  };
}

function restoredPermissions(response: RecordValue): RecordValue {
  if (!response.approvalPolicy || !response.approvalsReviewer)
    throw new CodexError('Codex 未返回完整权限配置，未继续本轮。');
  const profile = text(record(response.activePermissionProfile).id);
  const nativeSandbox = text(record(response.sandbox).type);
  const sandbox = { readOnly: 'read-only', workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' }[
    nativeSandbox
  ];
  if (!profile && !sandbox) throw new CodexError('Codex 当前权限配置不能安全恢复，未继续本轮。');
  return {
    approvalPolicy: response.approvalPolicy,
    approvalsReviewer: response.approvalsReviewer,
    ...(profile ? { permissions: profile } : { sandbox }),
  };
}

/** 空线程仅解析原生有效默认；不发送 turn/start，也不持久化探测会话。 */
export async function readNativePermissionDefaults(client: CodexClient, cwd: string): Promise<RecordValue> {
  const response = await client.request('thread/start', { cwd, ephemeral: true });
  const threadId = text(record(response.thread).id);
  try {
    if (!threadId) throw new CodexError('Codex 未返回权限配置身份，未继续本轮。');
    return restoredPermissions(response);
  } finally {
    if (threadId) await client.request('thread/unsubscribe', { threadId });
  }
}

export function nativePermissionRestore(client: CodexClient, input: AgentTurnInput): Promise<RecordValue> {
  if (!input.sessionId || input.permission?.agent !== 'codex' || input.permission.mode !== 'native')
    return Promise.resolve({});
  return readNativePermissionDefaults(client, input.workspace.dir);
}
