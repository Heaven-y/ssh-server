import { Check, Moon, Sun } from 'lucide-react';
import { useUiPreferences } from '../../ui/ui-preferences';

export function AppearanceSettings() {
  const theme = useUiPreferences((state) => state.theme);
  const toggle = useUiPreferences((state) => state.toggleTheme);
  return (
    <section aria-label="外观" className="space-y-3 border-b border-border pb-6">
      <h4 className="text-xs font-medium text-muted-foreground">外观</h4>
      <div className="flex flex-wrap gap-3">
        {(['light', 'dark'] as const).map((value) => {
          const Icon = value === 'light' ? Sun : Moon;
          return (
            <button
              type="button"
              key={value}
              aria-pressed={theme === value}
              className="appearance-theme"
              data-theme={value}
              onClick={() => {
                if (theme !== value) toggle();
              }}
            >
              <span aria-hidden className="appearance-window">
                <i />
                <span>
                  <i />
                  <i />
                  <i />
                </span>
              </span>
              <span className="flex items-center gap-2 px-1 pt-2 text-xs">
                <Icon aria-hidden className="size-3.5" />
                {value === 'light' ? '浅色' : '深色'}
                <Check aria-hidden className={`ml-auto size-3.5 ${theme === value ? '' : 'invisible'}`} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
