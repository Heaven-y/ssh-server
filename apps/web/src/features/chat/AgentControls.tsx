import { Fragment } from 'react';
import { useChat } from './chat-store';
import { ModelOptionsMenu } from './ModelOptionsMenu';
import { ContextStatus } from './ContextStatus';

export { AGENT_LABELS } from './ModelOptionsMenu';

export function AgentControls({ disabled = false }: { disabled?: boolean }) {
  const scope = useChat((state) => JSON.stringify([state.workspaceId, state.agent, state.sessionId]));
  return (
    <Fragment key={scope}>
      <ModelOptionsMenu disabled={disabled} />
      <ContextStatus />
    </Fragment>
  );
}
