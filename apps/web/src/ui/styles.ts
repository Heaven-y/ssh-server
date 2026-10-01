// 共用的控件样式；可交互组件的边框用 border-strong（对比度 ≥ 3:1，见 ui-layout 第 0 节）

const BUTTON_BASE =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50';

const BUTTON_VARIANTS = {
  primary: 'bg-accent text-accent-foreground hover:bg-accent/90',
  outline: 'border border-border-strong text-foreground hover:bg-muted',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
  danger: 'border border-destructive text-destructive-foreground hover:bg-destructive/15',
} as const;

export const buttonClass = (variant: keyof typeof BUTTON_VARIANTS = 'outline') =>
  `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]}`;

export const inputClass =
  'w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground aria-invalid:border-destructive';
