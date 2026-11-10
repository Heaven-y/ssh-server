import { SessionError } from '../agents/errors';

const MESSAGES = {
  invalid_reference: '会话引用无效，请从 AgentDeck 重新复制引用。',
  invalid_cursor: '分页游标无效或不属于此引用，请不带 cursor 重新读取。',
  stale_cursor: '会话或项目已变化，请不带 cursor 从头重新读取。',
  session_missing: '引用的会话不存在或不属于指定项目。',
  read_failed: '会话读取失败，请检查本机 CLI 与配置。',
  read_cancelled: '会话读取已取消。',
} as const;

export class SessionReadError extends Error {
  constructor(public readonly code: keyof typeof MESSAGES) {
    super(MESSAGES[code]);
    this.name = 'SessionReadError';
  }
}

/** 原生错误可能包含地址、令牌或配置片段，只传递本模块的固定错误。 */
export function safeSessionReadError(error: unknown, signal?: AbortSignal): SessionReadError {
  if (error instanceof SessionReadError) return error;
  if (signal?.aborted) return new SessionReadError('read_cancelled');
  if (error instanceof SessionError && error.status === 404) return new SessionReadError('session_missing');
  return new SessionReadError('read_failed');
}
