import { Fragment } from 'react';
import { useChat } from './chat-store';
import { ModelOptionsMenu } from './ModelOptionsMenu';

export function AgentControls({ disabled = false }: { disabled?: boolean }) {
  const scope = useChat((state) => state.conversationVersion);
  return (
    <Fragment key={scope}>
      <ModelOptionsMenu disabled={disabled} />
    </Fragment>
  );
}
