import type { SpotlightSettings as Settings } from '@agentdeck/shared/settings';

export function SpotlightSettings({
  value,
  disabled,
  change,
}: {
  value: Settings;
  disabled: boolean;
  change(value: Settings): void;
}) {
  return (
    <section aria-label="鼠标光影" className="space-y-4 border-b border-border pb-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium">鼠标光影</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            仅在聊天输入框内跟随鼠标，颜色随深浅主题自动适配。
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="鼠标光影"
          aria-checked={value.enabled}
          disabled={disabled}
          className="spotlight-switch"
          onClick={() => change({ ...value, enabled: !value.enabled })}
        >
          <span />
        </button>
      </div>
    </section>
  );
}
