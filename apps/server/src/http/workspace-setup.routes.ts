import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SshAuthModeSchema, WorkspaceSetupCreateSchema, WorkspaceSetupInputSchema } from '@ssh-server/shared';
import { WorkspaceSetupError } from '../workspaces/setup/errors';
import { SshConnectionError } from '../ssh/connection';
import { RemoteFilesError } from '../remote-files/errors';
import { SyncError } from '../sync/errors';
import { WorkspaceValidationError } from '../workspaces/store';
import type { WorkspaceSetup } from '../workspaces/setup/service';

const DirectorySchema = z
  .object({ path: z.string().max(4096).optional(), cursor: z.string().uuid().optional() })
  .strict();
const TargetSchema = z
  .object({
    sshHost: z.string().min(1).max(200),
    authMode: SshAuthModeSchema.optional(),
    remoteDir: WorkspaceSetupInputSchema.shape.remoteDir.optional(),
  })
  .strict();
const SessionSchema = z.object({ session: z.string().uuid() }).strict();
const RemoteDirectorySchema = SessionSchema.extend({
  path: z.string().min(1).max(4096),
  cursor: z.string().max(200).optional(),
});

async function respond<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const close = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  reply.raw.once('close', close);
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error instanceof WorkspaceValidationError)
      return reply.code(400).send({ field: error.field, message: error.message });
    if (
      error instanceof WorkspaceSetupError ||
      error instanceof SshConnectionError ||
      error instanceof RemoteFilesError ||
      error instanceof SyncError
    )
      return reply.code(409).send({ code: error.code, message: error.message });
    return reply
      .code(502)
      .send({ code: 'setup_unavailable', message: '工作区检查未完成，请检查本地目录、SSH认证和远端权限后重试' });
  } finally {
    reply.raw.off('close', close);
  }
}
function post<T>(
  app: FastifyInstance,
  route: string,
  schema: z.ZodType<T>,
  action: (input: T, signal: AbortSignal) => Promise<unknown>,
) {
  app.post(route, (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: '向导请求参数不合法' });
    return respond(request, reply, (signal) => action(parsed.data, signal));
  });
}
export function registerWorkspaceSetupRoutes(app: FastifyInstance, setup: WorkspaceSetup) {
  post(app, '/api/workspace-setup/local-directory', DirectorySchema, (input, signal) =>
    setup.localDirectory(input, signal),
  );
  post(
    app,
    '/api/workspace-setup/local-directory/close',
    z.object({ cursor: z.string().uuid() }).strict(),
    async (input) => {
      await setup.closeLocal(input.cursor);
      return { closed: true };
    },
  );
  post(app, '/api/workspace-setup/remote/open', TargetSchema, (input, signal) => setup.openRemote(input, signal));
  post(app, '/api/workspace-setup/remote/list', RemoteDirectorySchema, (input, signal) =>
    setup.readRemote(input.session, input, signal),
  );
  post(
    app,
    '/api/workspace-setup/remote/size',
    SessionSchema.extend({ path: z.string().min(1).max(4096) }),
    (input, signal) => setup.remoteSize(input.session, input.path, signal),
  );
  post(app, '/api/workspace-setup/remote/close', SessionSchema, (input) => {
    setup.closeRemote(input.session);
    return Promise.resolve({ closed: true });
  });
  post(app, '/api/workspace-setup/preview', WorkspaceSetupInputSchema, (input, signal) => setup.preview(input, signal));
  post(app, '/api/workspace-setup/verify', WorkspaceSetupInputSchema, (input, signal) => setup.verify(input, signal));
  post(app, '/api/workspace-setup/revoke', z.object({ verification: z.string().uuid() }).strict(), (input) => {
    setup.revoke(input.verification);
    return Promise.resolve({ revoked: true });
  });
  app.addHook('preClose', () => setup.dispose());
}
/** 工作区创建的唯一入口：必须提供一次性验证票据并确认首次同步。 */
export function createVerifiedWorkspace(setup: WorkspaceSetup, request: FastifyRequest, reply: FastifyReply) {
  const parsed = WorkspaceSetupCreateSchema.safeParse(request.body);
  if (!parsed.success)
    return reply
      .code(400)
      .send({ code: 'setup_verification_required', message: '请通过连接向导验证配置，并明确确认首次同步后创建' });
  return respond(request, reply, (signal) => setup.create(parsed.data, signal));
}
