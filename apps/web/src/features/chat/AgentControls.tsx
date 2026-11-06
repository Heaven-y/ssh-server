import { Fragment, type ReactNode } from 'react';
import { useChat } from './chat-store';
import { ModelOptionsMenu } from './ModelOptionsMenu';
import { PermissionOptionsMenu } from './PermissionOptionsMenu';
import { CapabilityPicker } from './CapabilityPicker';

export function AgentControls({ disabled = false, children }: { disabled?: boolean; children: ReactNode }) {
  const scope = useChat((state) => state.conversationVersion);
  return (
    <Fragment key={scope}>
      <div className="flex min-w-0 items-center gap-1.5">
        <CapabilityPicker disabled={disabled} />
        <PermissionOptionsMenu disabled={disabled} />
      </div>
      <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
        <ModelOptionsMenu disabled={disabled} />
        {children}
      </div>
    </Fragment>
  );
}
