// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToolGroup } from '../../../src/features/chat/ToolGroup';
import { projectTimeline, type ToolItem } from '../../../src/features/chat/timeline-model';

afterEach(cleanup);
const source: ToolItem[] = Array.from({ length: 1000 }, (_, i) => ({
  kind: 'tool',
  id: `read-${i}`,
  name: 'Read',
  input: { path: `src/example-${i}.py` },
  output: '输出\n'.repeat(50),
  status: 'done',
}));
function fixture(expanded: boolean) {
  const row = projectTimeline(source)[0]!;
  if (row.kind !== 'read-group') throw new Error('读取组缺失');
  return (
    <ToolGroup
      items={row.items}
      expanded={expanded}
      onExpandedChange={vi.fn()}
      itemExpanded={() => false}
      setItemExpanded={vi.fn()}
    />
  );
}

it('折叠读取组不挂载工具参数/输出，展开后内部DOM也保持有界', () => {
  const { container, rerender } = render(fixture(false));
  expect(container.querySelectorAll('details')).toHaveLength(1);
  expect(container.querySelectorAll('pre')).toHaveLength(0);
  rerender(fixture(true));
  expect(container.querySelectorAll('details')).toHaveLength(41);
  expect(container.querySelectorAll('pre')).toHaveLength(80);
});
