import { parseSessionReference, sessionReferenceHash, type SessionLocation } from '@agentdeck/shared/conversation';
export type { SessionLocation } from '@agentdeck/shared/conversation';
const invalidLink = () => new Error('会话链接格式无效，请重新复制完整链接');

/** 链接只负责本网页定位，不承诺原生客户端 URI 或向 Agent 注入上下文。 */
export function sessionLink(location: SessionLocation, base: string): string {
  const url = new URL(base);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalidLink();
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = sessionReferenceHash(location);
  return url.href;
}

export function parseSessionLink(hash: string): SessionLocation | undefined {
  if (!hash || hash === '#') return undefined;
  if (hash.length > 1024 || !hash.startsWith('#session?')) throw invalidLink();
  return parseSessionReference(hash);
}

export const SESSION_OPEN_EVENT = 'agentdeck:session-open';

/** 相同链接也能重新打开；不把自有协议交给浏览器启动外部应用。 */
export function navigateToSessionReference(reference: string): void {
  const hash = sessionReferenceHash(parseSessionReference(reference));
  if (window.location.hash !== hash) window.location.hash = hash;
  else window.dispatchEvent(new CustomEvent(SESSION_OPEN_EVENT, { detail: hash }));
}

export type TextSessionReference = { start: number; end: number; text: string; location: SessionLocation };

/** 只识别完整链接；裸 ID 缺少 CLI 和项目，不能推测其来源。 */
export function findSessionReferences(text: string): TextSessionReference[] {
  const found: TextSessionReference[] = [];
  const pattern = /(?:agentdeck:\/\/|https?:\/\/)[^\s<>"'`[\]()，。；！？、]+/g;
  for (const match of text.matchAll(pattern)) {
    const value = match[0].replace(/[.,;!?]+$/, '');
    try {
      const location = parseSessionReference(value);
      found.push({ start: match.index, end: match.index + value.length, text: value, location });
    } catch {
      /* 普通 URL 与不完整的链接保持原文。 */
    }
  }
  return found;
}
