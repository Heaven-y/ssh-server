import { TERMINAL_LIMITS } from '@ssh-server/shared';

export function prepareTerminalPaste(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > TERMINAL_LIMITS.inputBytes) throw new Error('单次粘贴最多 256 KiB，请缩小内容后重试；本次未发送');
  return bytes;
}
export function createTerminalPaste(options: {
  send: (bytes: Uint8Array) => boolean;
  changed: (pending: boolean) => void;
}) {
  let content: Uint8Array | undefined;
  let offset = 0;
  function flush() {
    if (!content) return;
    while (offset < content.length) {
      const chunk = content.subarray(offset, offset + TERMINAL_LIMITS.frameBytes);
      if (!options.send(chunk)) return;
      offset += chunk.length;
    }
    content = undefined;
    offset = 0;
    options.changed(false);
  }
  return {
    enqueue(bytes: Uint8Array): boolean {
      if (content || bytes.length > TERMINAL_LIMITS.inputBytes) return false;
      if (!bytes.length) return true;
      content = bytes;
      offset = 0;
      options.changed(true);
      flush();
      return true;
    },
    flush,
    cancel() {
      content = undefined;
      offset = 0;
      options.changed(false);
    },
  };
}
