import { ListTree, MessageSquare } from 'lucide-react';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { SubagentHistoryButton } from '../sessions/SubagentHistoryDialog';
import { useChat } from './chat-store';

export function ConversationViewControls() {
  const view = useChat((state) => state.view);
  const setView = useChat((state) => state.setView);
  return (
    <div className="conversation-view-controls flex shrink-0 items-center gap-1">
      <SegmentedControl
        label="会话视图"
        value={view}
        onChange={setView}
        options={[
          {
            value: 'chat',
            label: (
              <>
                <MessageSquare aria-hidden className="size-3.5" />
                <span>对话</span>
              </>
            ),
          },
          {
            value: 'trajectory',
            label: (
              <>
                <ListTree aria-hidden className="size-3.5" />
                <span>轨迹</span>
              </>
            ),
          },
        ]}
      />
      <SubagentHistoryButton />
    </div>
  );
}
