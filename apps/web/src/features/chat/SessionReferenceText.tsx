import type { ReactNode } from 'react';
import { defaultComponents, defaultUrlTransform, type Components, type UrlTransform } from 'streamdown';
import { parseSessionReference, sessionReferenceHash } from '@agentdeck/shared/conversation';
import { findSessionReferences, navigateToSessionReference } from '../sessions/session-links';

export function SessionReferenceText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const reference of findSessionReferences(text)) {
    parts.push(text.slice(offset, reference.start));
    parts.push(
      <a
        key={reference.start}
        href={sessionReferenceHash(reference.location)}
        className="break-all underline decoration-accent/50 underline-offset-4 hover:text-accent"
        onClick={(event) => {
          event.preventDefault();
          navigateToSessionReference(reference.text);
        }}
      >
        {reference.text}
      </a>,
    );
    offset = reference.end;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}

export const sessionMarkdownUrl: UrlTransform = (url, key, node) => {
  if (key === 'href') {
    try {
      return sessionReferenceHash(parseSessionReference(url));
    } catch {
      /* 其他链接沿用 Markdown 的协议限制。 */
    }
  }
  const colon = url.indexOf(':');
  if (colon >= 0 && !/[/?#]/.test(url.slice(0, colon)) && !/^(https?|mailto|tel|irc|ircs|xmpp):/i.test(url)) return '';
  return defaultUrlTransform(url, key, node);
};

const SessionMarkdownAnchor: NonNullable<Components['a']> = (props) => {
  let reference: string | undefined;
  try {
    reference = sessionReferenceHash(parseSessionReference(props.href ?? ''));
  } catch {
    /* 普通链接保持原行为。 */
  }
  if (!reference) {
    const DefaultAnchor = defaultComponents.a;
    return <DefaultAnchor {...props} />;
  }
  const { children } = props;
  return (
    <a
      href={reference}
      onClick={(event) => {
        event.preventDefault();
        navigateToSessionReference(reference);
      }}
    >
      {children}
    </a>
  );
};

export const sessionMarkdownComponents: Components = { a: SessionMarkdownAnchor };
