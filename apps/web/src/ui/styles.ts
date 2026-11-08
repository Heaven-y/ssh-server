// 共用控件采用中性主操作、细边框与明确焦点；状态颜色只用于对应反馈。

const BUTTON_BASE =
  'ui-button inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium leading-5 transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40';

const BUTTON_VARIANTS = {
  primary: 'bg-accent text-accent-foreground hover:bg-accent/90',
  outline: 'border border-border-strong bg-transparent text-foreground hover:bg-muted',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
  danger: 'border border-destructive/70 text-destructive-foreground hover:bg-destructive/15',
} as const;

export const buttonClass = (variant: keyof typeof BUTTON_VARIANTS = 'outline') =>
  `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]}`;

export const inputClass =
  'ui-control min-w-0 w-full rounded-lg border border-border-strong bg-background px-3 py-2 text-[13px] leading-5 text-foreground placeholder:text-muted-foreground aria-invalid:border-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-interactive disabled:opacity-50';
