import { lazy, Suspense, useState } from 'react';
import ProductSettingsDialog from './ProductSettingsDialog';

const NativeConfigDialog = lazy(() => import('./NativeConfigDialog'));
/** 同时只挂载一个对话框；离开原生视图立即清理其敏感内容。 */
export default function SettingsDialog({ onClose }: { onClose(): void }) {
  const [native, setNative] = useState(false);
  if (!native) return <ProductSettingsDialog onClose={onClose} onNative={() => setNative(true)} />;
  return (
    <Suspense
      fallback={
        <p role="status" className="absolute right-4 top-14 z-50 rounded border border-border bg-card p-3 text-sm">
          正在打开原生配置…
        </p>
      }
    >
      <NativeConfigDialog onClose={onClose} onBack={() => setNative(false)} />
    </Suspense>
  );
}
