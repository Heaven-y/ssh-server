import { Menu, MenuButton, MenuProvider } from '@ariakit/react';
import { ArrowDownWideNarrow } from 'lucide-react';
import { MenuChoice } from '../../ui/MenuChoice';
import { useSessionOrder } from './session-order';

export function SessionSortMenu() {
  const mode = useSessionOrder((state) => state.mode);
  const choose = useSessionOrder((state) => state.setMode);
  return (
    <MenuProvider placement="bottom-end">
      <MenuButton
        aria-label="会话排序"
        title="会话排序"
        className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-interactive"
      >
        <ArrowDownWideNarrow aria-hidden className="size-3.5" />
      </MenuButton>
      <Menu
        portal
        unmountOnHide
        gutter={6}
        aria-label="会话排序方式"
        className="z-50 min-w-36 rounded-xl border border-border bg-card p-1.5 shadow-lg"
      >
        {(
          [
            ['recent', '最近活动'],
            ['name', '名称'],
            ['manual', '手动排序'],
          ] as const
        ).map(([value, label]) => (
          <MenuChoice key={value} checked={mode === value} choose={() => choose(value)}>
            {label}
          </MenuChoice>
        ))}
      </Menu>
    </MenuProvider>
  );
}
