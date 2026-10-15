import { lazy, Suspense, useState } from 'react';
import ProductSettingsDialog from './ProductSettingsDialog';
import type { NativeConfigAgent } from '@ssh-server/shared';

const NativeConfigDialog = lazy(() => import('./NativeConfigDialog'));
/** 同时只挂载一个对话框；离开原生视图立即清理其敏感内容。 */
export default function SettingsDialog({ onClose }: { onClose(): void }) {
  const [native, setNative] = useState<NativeConfigAgent | null>(null);
  if (!native) return <ProductSettingsDialog onClose={onClose} onNative={setNative} />;
  return (
    <Suspense
      fallback={
        <p role="status" className="absolute right-4 top-14 z-50 rounded border border-border bg-card p-3 text-sm">
          正在打开原生配置…
        </p>
      }
    >
      <NativeConfigDialog agent={native} onClose={onClose} onBack={() => setNative(null)} />
    </Suspense>
  );
}
