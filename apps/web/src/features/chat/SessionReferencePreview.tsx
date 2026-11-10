import { Link } from 'lucide-react';
import { AGENT_LABELS } from '../../cli/shared/labels';
import { findSessionReferences, navigateToSessionReference } from '../sessions/session-links';
import { SessionToolsPanel } from '../settings/SessionToolsPanel';
import { useChat } from './chat-store';

export function SessionReferencePreview({ text }: { text: string }) {
  const agent = useChat((state) => state.agent);
  const references = [...new Map(findSessionReferences(text).map((value) => [value.text, value])).values()];
  if (!references.length) return null;
  return (
    <div className="space-y-2 border-t border-border/60 px-4 py-3">
      <div aria-label="引用的会话" className="flex flex-wrap gap-2">
        {references.map(({ text: reference, location }) => (
          <button
            key={reference}
            type="button"
            title={`打开 ${location.sessionId}`}
            onClick={() => navigateToSessionReference(reference)}
            className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs hover:bg-muted"
          >
            <Link aria-hidden className="size-3 shrink-0" />
            <span className="truncate">
              {AGENT_LABELS[location.agent]} · {location.sessionId}
            </span>
          </button>
        ))}
      </div>
      <SessionToolsPanel key={agent} agent={agent} compact />
    </div>
  );
}
