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
  let bracketed = false;
  let closingFrame = false;
  const end = new TextEncoder().encode('\x1b[201~');
  function flush() {
    if (!content) return;
    while (offset < content.length) {
      const chunk = content.subarray(offset, offset + TERMINAL_LIMITS.frameBytes);
      if (!options.send(chunk)) return;
      offset += chunk.length;
    }
    content = undefined;
    offset = 0;
    closingFrame = false;
    options.changed(false);
  }
  return {
    enqueue(bytes: Uint8Array, framed = false): boolean {
      if (content || bytes.length > TERMINAL_LIMITS.inputBytes) return false;
      if (!bytes.length) return true;
      bracketed = framed;
      if (framed) {
        const start = new TextEncoder().encode('\x1b[200~');
        content = new Uint8Array(start.length + bytes.length + end.length);
        content.set(start);
        content.set(bytes, start.length);
        content.set(end, start.length + bytes.length);
      } else content = bytes;
      offset = 0;
      options.changed(true);
      flush();
      return true;
    },
    flush,
    cancel(discard = false) {
      // 已发送起始帧时，取消正文也必须闭合边界；断线/销毁则彻底丢弃。
      if (closingFrame && !discard) {
        flush();
        return;
      }
      if (!discard && bracketed && content && offset > 0) {
        content = end;
        offset = 0;
        bracketed = false;
        closingFrame = true;
        flush();
        return;
      }
      content = undefined;
      offset = 0;
      closingFrame = false;
      options.changed(false);
    },
  };
}
