import type { FastifyInstance, FastifyRequest } from 'fastify';
import { WorkspaceRemovalError, type WorkspaceActivity } from '../workspaces/activity';

type Lease = { release(): void; handlerDone: boolean; closed: boolean };
function workspaceId(request: FastifyRequest): string | undefined {
  const route = request.routeOptions.url;
  if (!route?.startsWith('/api/workspaces/:id')) return undefined;
  if (route === '/api/workspaces/:id/removal' || (route === '/api/workspaces/:id' && request.method === 'DELETE'))
    return undefined;
  const id = (request.params as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' ? id : undefined;
}

/** HTTP写操作真正收尾后才释放租约；断开响应不能伪装为文件写入已取消。 */
export function registerWorkspaceActivity(app: FastifyInstance, activity: WorkspaceActivity) {
  const leases = new WeakMap<FastifyRequest, Lease>();
  app.addHook('onRoute', (route) => {
    const handler = route.handler;
    route.handler = async function (request, reply) {
      try {
        return await handler.call(this, request, reply);
      } finally {
        const lease = leases.get(request);
        if (lease) {
          lease.handlerDone = true;
          if (lease.closed) {
            lease.release();
            leases.delete(request);
          }
        }
      }
    };
  });
  app.addHook('preHandler', (request, reply, done) => {
    const id = workspaceId(request);
    if (!id) {
      done();
      return;
    }
    try {
      activity.assertOpen(id);
      if (request.headers.upgrade?.toLowerCase() !== 'websocket') {
        const release = activity.acquire(id);
        const lease: Lease = { release, handlerDone: false, closed: reply.raw.destroyed };
        leases.set(request, lease);
        reply.raw.once('close', () => {
          lease.closed = true;
          if (lease.handlerDone) release();
        });
      }
    } catch (error) {
      if (error instanceof WorkspaceRemovalError)
        void reply.code(error.status).send({ code: error.code, message: error.message });
      else done(error as Error);
      return;
    }
    done();
  });
  app.addHook('onResponse', (request, _reply, done) => {
    const lease = leases.get(request);
    if (lease) {
      lease.closed = true;
      if (lease.handlerDone) {
        lease.release();
        leases.delete(request);
      }
    }
    done();
  });
}
