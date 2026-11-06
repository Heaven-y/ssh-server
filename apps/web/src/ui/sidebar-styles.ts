export const sidebarMenuClass = 'z-50 min-w-48 rounded-xl border border-border bg-card p-1 text-foreground shadow-lg';
export const sidebarMenuItemClass =
  'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-none data-active-item:bg-muted data-active-item:ring-1 data-active-item:ring-accent';
export const sidebarItemClass = (collapsed: boolean) =>
  `flex min-h-9 w-full min-w-0 items-center gap-3 rounded-lg text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${collapsed ? 'justify-center px-0' : 'px-3'}`;
