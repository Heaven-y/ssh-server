import { expect, it } from 'vitest';
import {
  minimumLayoutSize,
  paneIds,
  removePane,
  replacePaneId,
  splitPane,
  type TerminalLayoutNode,
} from '../../../src/features/terminal/layout';

it('嵌套分屏和相邻关闭保留原paneId，严格限制4叶子', () => {
  let tree: TerminalLayoutNode = { kind: 'pane', paneId: 'first' };
  tree = splitPane(tree, 'first', 'second', 'horizontal');
  tree = splitPane(tree, 'second', 'third', 'vertical');
  tree = splitPane(tree, 'third', 'fourth', 'horizontal');
  expect(paneIds(tree)).toEqual(['first', 'second', 'third', 'fourth']);
  expect(() => splitPane(tree, 'first', 'fifth', 'vertical')).toThrow('4');
  expect(paneIds(removePane(tree, 'third')!)).toEqual(['first', 'second', 'fourth']);
  expect(paneIds(replacePaneId(tree, 'second', 'replacement'))).toEqual(['first', 'replacement', 'third', 'fourth']);
  expect(minimumLayoutSize(tree)).toEqual({ width: 792, height: 286 });
});
