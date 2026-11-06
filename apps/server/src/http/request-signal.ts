import type { FastifyReply, FastifyRequest } from 'fastify';

export function requestSignal(request: FastifyRequest, reply: FastifyReply, onAbort?: () => void) {
  const controller = new AbortController();
  const abort = () => {
    controller.abort(Object.assign(new Error('请求已取消'), { code: 'cancelled' }));
    onAbort?.();
  };
  const cleanup = () => {
    request.raw.removeListener('aborted', abort);
    reply.raw.removeListener('close', closed);
    reply.raw.removeListener('finish', cleanup);
  };
  const closed = () => {
    if (!reply.raw.writableFinished) abort();
    cleanup();
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', closed);
  reply.raw.once('finish', cleanup);
  if (request.raw.aborted || reply.raw.destroyed) abort();
  return controller.signal;
}
