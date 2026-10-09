import { useChat } from './chat-store';
import { ModelOptionsMenu } from './ModelOptionsMenu';

export { AGENT_LABELS } from './ModelOptionsMenu';

export function AgentControls({ disabled = false }: { disabled?: boolean }) {
  const scope = useChat((state) => JSON.stringify([state.workspaceId, state.agent, state.sessionId]));
  return <ModelOptionsMenu key={scope} disabled={disabled} />;
}
