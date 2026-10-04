import { useEffect, useRef } from 'react';

export function SetupError({ message }: { message?: string }) {
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) alert.current?.focus();
  }, [message]);
  if (!message) return null;
  return (
    <p
      ref={alert}
      role="alert"
      tabIndex={-1}
      className="text-xs leading-5 text-destructive-foreground focus-visible:outline-2 focus-visible:outline-accent"
    >
      {message}
    </p>
  );
}
