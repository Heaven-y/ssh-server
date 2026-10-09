export type WorkspacePanelKind = 'resources' | 'files';
export type PanelRect = { left: number; top: number; width: number; height: number };
export type PanelViewport = { width: number; height: number; top: number };
const MARGIN = 12;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** 整个面板留在可视范围内，窗口变小后标题与缩放柄仍然可达。 */
export function fitPanel(rect: PanelRect, viewport: PanelViewport): PanelRect {
  const availableWidth = Math.max(1, viewport.width - MARGIN * 2);
  const availableHeight = Math.max(1, viewport.height - viewport.top - MARGIN);
  const width = clamp(rect.width, Math.min(360, availableWidth), Math.min(960, availableWidth));
  const height = clamp(rect.height, Math.min(320, availableHeight), availableHeight);
  return {
    left: clamp(rect.left, MARGIN, viewport.width - width - MARGIN),
    top: clamp(rect.top, viewport.top, viewport.height - height - MARGIN),
    width,
    height,
  };
}
export function defaultPanelRect(kind: WorkspacePanelKind, viewport: PanelViewport, width = 420): PanelRect {
  return fitPanel(
    {
      left: viewport.width - width - MARGIN - (kind === 'files' ? 432 : 0),
      top: viewport.top + (kind === 'files' ? 32 : 0),
      width,
      height: 600,
    },
    viewport,
  );
}
export function changePanel(rect: PanelRect, mode: 'move' | 'resize', x: number, y: number): PanelRect {
  return mode === 'move'
    ? { ...rect, left: rect.left + x, top: rect.top + y }
    : { ...rect, width: rect.width + x, height: rect.height + y };
}
