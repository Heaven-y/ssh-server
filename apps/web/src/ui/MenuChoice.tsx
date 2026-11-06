import { MenuItem } from '@ariakit/react';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
export const modelMenuItemClass =
  'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[13px] outline-none data-active-item:bg-muted data-active-item:ring-1 data-active-item:ring-border-strong aria-disabled:cursor-not-allowed aria-disabled:opacity-45';
export function MenuChoice({
  checked,
  disabled,
  choose,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  choose(): void;
  children: ReactNode;
}) {
  return (
    <MenuItem
      role="menuitemradio"
      aria-checked={checked}
      disabled={disabled}
      onClick={choose}
      className={modelMenuItemClass}
    >
      <Check aria-hidden className={`size-3.5 shrink-0 ${checked ? '' : 'invisible'}`} />
      <span className="min-w-0 flex-1">{children}</span>
    </MenuItem>
  );
}
