import { useMemo, type ComponentProps } from 'react';
import type { SessionSummary } from '@agentdeck/shared/conversation';
import { ProjectSessionRow } from './ProjectSessionRow';
import { sessionOrderKey, useSessionOrder } from './session-order';

const MIME = 'application/x-agentdeck-session';
export function SortableSessionRow({
  sessions,
  ...props
}: ComponentProps<typeof ProjectSessionRow> & { sessions: SessionSummary[] }) {
  const move = useSessionOrder((state) => state.move);
  const project = props.workspaceId ?? '';
  const id = sessionOrderKey(props.session);
  const visible = useMemo(() => sessions.map(sessionOrderKey), [sessions]);
  return (
    <ProjectSessionRow
      {...props}
      rowProps={{
        draggable: true,
        onDragStart(event) {
          event.dataTransfer.setData(MIME, JSON.stringify([project, id]));
          event.dataTransfer.effectAllowed = 'move';
        },
        onDragOver(event) {
          if (event.dataTransfer.types.includes(MIME)) event.preventDefault();
        },
        onDrop(event) {
          event.preventDefault();
          try {
            const [from, source] = JSON.parse(event.dataTransfer.getData(MIME)) as string[];
            if (from === project && source) move(project, source, id, visible);
          } catch {
            /* 非本应用的拖动不改变顺序。 */
          }
        },
        onKeyDown(event) {
          if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const target = visible[visible.indexOf(id) + (event.key === 'ArrowUp' ? -1 : 1)];
          if (target) move(project, id, target, visible);
        },
      }}
    />
  );
}
