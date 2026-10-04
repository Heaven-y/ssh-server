import { useEffect, useRef, useState } from 'react';

/** 步骤只消费仍然归属本组件的响应；取消和StrictMode重挂载不接受迟到结果。 */
export function useCancelableRequest() {
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  const abort = () => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setError(undefined);
  };
  const run = async <T>(operation: (signal: AbortSignal) => Promise<T>) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError(undefined);
    try {
      const result = await operation(current.signal);
      if (!current.signal.aborted && controller.current === current) return result;
    } catch (error) {
      if (!current.signal.aborted && controller.current === current)
        setError(error instanceof Error ? error.message : '检查未完成，请重试');
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
    return undefined;
  };
  return { busy, error, run, abort };
}
