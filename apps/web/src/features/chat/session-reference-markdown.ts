import { defaultRemarkPlugins } from 'streamdown';
import { parseSessionReference, sessionReferenceHash } from '@agentdeck/shared/conversation';
import { findSessionReferences } from '../sessions/session-links';

type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[] };

function textLinks(node: MarkdownNode): MarkdownNode[] {
  const text = node.value ?? '';
  const refs = findSessionReferences(text);
  if (!refs.length) return [node];
  const result: MarkdownNode[] = [];
  let start = 0;
  for (const reference of refs) {
    result.push(
      { type: 'text', value: text.slice(start, reference.start) },
      {
        type: 'link',
        url: sessionReferenceHash(reference.location),
        children: [{ type: 'text', value: reference.text }],
      },
    );
    start = reference.end;
  }
  result.push({ type: 'text', value: text.slice(start) });
  return result;
}

function visit(node: MarkdownNode): void {
  if (node.type === 'linkReference') return;
  if (node.type === 'link' || node.type === 'definition') {
    try {
      node.url = sessionReferenceHash(parseSessionReference(node.url ?? ''));
    } catch {
      /* 普通链接继续交给默认安全处理。 */
    }
    return;
  }
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text') return textLinks(child);
    visit(child);
    return [child];
  });
}

/** 在默认 HTML 清理前把已验证引用变为页内链接，代码块与其他协议不受影响。 */
function remarkSessionReferences() {
  return visit;
}
export const sessionRemarkPlugins = [...Object.values(defaultRemarkPlugins), remarkSessionReferences];
