import type { ReactNode } from 'react';
import { DEFAULT_SPOTLIGHT } from '@agentdeck/shared/settings';
import { useProductSettings } from '../settings/use-product-settings';
import { useSpotlightPreview } from '../../ui/spotlight-preview';
import { SpotlightSurface } from '../../ui/SpotlightSurface';

export function ComposerSurface({ children }: { children: ReactNode }) {
  const saved = useProductSettings();
  const preview = useSpotlightPreview((state) => state.value);
  const settings = preview ?? saved.data?.settings.spotlight ?? DEFAULT_SPOTLIGHT;
  return (
    <SpotlightSurface enabled={settings.enabled} className="composer-card">
      {children}
    </SpotlightSurface>
  );
}
