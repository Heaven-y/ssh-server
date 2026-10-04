import { TERMINAL_LIMITS } from '@ssh-server/shared';

export type TerminalLayoutNode =
  | { kind: 'pane'; paneId: string }
  | {
      kind: 'split';
      id: string;
      orientation: 'horizontal' | 'vertical';
      children: [TerminalLayoutNode, TerminalLayoutNode];
    };
export function paneIds(tree: TerminalLayoutNode): string[] {
  return tree.kind === 'pane' ? [tree.paneId] : tree.children.flatMap(paneIds);
}
export function splitPane(
  tree: TerminalLayoutNode,
  paneId: string,
  nextPaneId: string,
  orientation: 'horizontal' | 'vertical',
): TerminalLayoutNode {
  if (paneIds(tree).length >= TERMINAL_LIMITS.panes) throw new Error('每个终端标签最多4个窗格');
  function split(node: TerminalLayoutNode): TerminalLayoutNode {
    if (node.kind === 'pane')
      return node.paneId !== paneId
        ? node
        : {
            kind: 'split',
            id: `split-${nextPaneId}`,
            orientation,
            children: [node, { kind: 'pane', paneId: nextPaneId }],
          };
    return { ...node, children: [split(node.children[0]), split(node.children[1])] };
  }
  return split(tree);
}
export function removePane(tree: TerminalLayoutNode, paneId: string): TerminalLayoutNode | undefined {
  if (tree.kind === 'pane') return tree.paneId === paneId ? undefined : tree;
  const left = removePane(tree.children[0], paneId);
  const right = removePane(tree.children[1], paneId);
  if (!left) return right;
  if (!right) return left;
  return { ...tree, children: [left, right] };
}
export function replacePaneId(tree: TerminalLayoutNode, before: string, after: string): TerminalLayoutNode {
  if (tree.kind === 'pane') return tree.paneId === before ? { kind: 'pane', paneId: after } : tree;
  return {
    ...tree,
    children: [replacePaneId(tree.children[0], before, after), replacePaneId(tree.children[1], before, after)],
  };
}
export function minimumLayoutSize(tree: TerminalLayoutNode): { width: number; height: number } {
  if (tree.kind === 'pane') return { width: 260, height: 140 };
  const [left, right] = tree.children.map(minimumLayoutSize) as [
    { width: number; height: number },
    { width: number; height: number },
  ];
  return tree.orientation === 'horizontal'
    ? { width: left.width + right.width + 6, height: Math.max(left.height, right.height) }
    : { width: Math.max(left.width, right.width), height: left.height + right.height + 6 };
}
