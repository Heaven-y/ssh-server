import {
  SshConsolePathSchema,
  SshConsoleServerIdSchema,
  SshConsoleTerminalCreateSchema,
  TerminalSizeSchema,
} from '@agentdeck/shared/ssh';
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { SshConsoleError, consoleFailure } from '../console/errors';
import type { SshConsoleService } from '../console/service';
import { requestSignal } from '../../../http/request-signal';

const Params = z.strictObject({ serverId: SshConsoleServerIdSchema });
const TerminalParams = Params.extend({ terminalId: z.string().uuid() });
const Empty = z.strictObject({});
const PathQuery = z.strictObject({ path: SshConsolePathSchema.optional() });
const PreviewQuery = z.strictObject({ path: SshConsolePathSchema });
const ReadQuery = z.strictObject({
  fromSeq: z
    .string()
    .regex(/^\d{1,16}$/)
    .default('0')
    .transform(Number)
    .refine(Number.isSafeInteger),
});
const Input = z.strictObject({ data: z.string().max(65536) });
const options: RouteShorthandOptions = {
  bodyLimit: 70000,
  logLevel: 'silent',
  onRequest: (_req, reply, done) => {
    reply.header('Cache-Control', 'no-store');
    done();
  },
  errorHandler: (error, _request, reply) => {
    const failure =
      error.statusCode && error.statusCode < 500 ? new SshConsoleError('invalid_request') : consoleFailure(error);
    void reply.code(failure.status).send({ code: failure.code, message: failure.message });
  },
};
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SshConsoleError('invalid_request');
  return parsed.data;
}
function terminal(req: FastifyRequest) {
  const params = checked(TerminalParams, req.params);
  checked(Empty, req.query);
  return params;
}
function registerReads(app: FastifyInstance, service: SshConsoleService) {
  app.get('/api/ssh-console/:serverId/overview', options, (req, reply) => {
    const { serverId } = checked(Params, req.params);
    const { path } = checked(PathQuery, req.query);
    return service.overview(serverId, path, requestSignal(req, reply));
  });
  app.get('/api/ssh-console/:serverId/processes', options, (req, reply) => {
    const { serverId } = checked(Params, req.params);
    checked(Empty, req.query);
    return service.processes(serverId, requestSignal(req, reply));
  });
  app.get('/api/ssh-console/:serverId/files', options, (req, reply) => {
    const { serverId } = checked(Params, req.params);
    const { path } = checked(PathQuery, req.query);
    return service.listDirectory(serverId, path, requestSignal(req, reply));
  });
  app.get('/api/ssh-console/:serverId/preview', options, (req, reply) => {
    const { serverId } = checked(Params, req.params);
    return service.preview(serverId, checked(PreviewQuery, req.query).path, requestSignal(req, reply));
  });
}
export function registerSshConsoleRoutes(app: FastifyInstance, service: SshConsoleService): void {
  registerReads(app, service);
  app.get('/api/ssh-console/:serverId/terminals', options, (req) => {
    const { serverId } = checked(Params, req.params);
    checked(Empty, req.query);
    return service.listTerminals(serverId);
  });
  app.post('/api/ssh-console/:serverId/terminals', options, (req) => {
    const { serverId } = checked(Params, req.params);
    checked(Empty, req.query);
    return service.createTerminal(serverId, checked(SshConsoleTerminalCreateSchema, req.body));
  });
  app.get('/api/ssh-console/:serverId/terminals/:terminalId', options, (req) => {
    const { serverId, terminalId } = checked(TerminalParams, req.params);
    return service.readTerminal(serverId, terminalId, checked(ReadQuery, req.query).fromSeq);
  });
  app.post('/api/ssh-console/:serverId/terminals/:terminalId/input', options, (req) => {
    const { serverId, terminalId } = terminal(req);
    return service.writeTerminal(serverId, terminalId, checked(Input, req.body).data);
  });
  app.post('/api/ssh-console/:serverId/terminals/:terminalId/resize', options, (req) => {
    const { serverId, terminalId } = terminal(req);
    return service.resizeTerminal(serverId, terminalId, checked(TerminalSizeSchema, req.body));
  });
  app.delete('/api/ssh-console/:serverId/terminals/:terminalId', options, async (req, reply) => {
    const { serverId, terminalId } = terminal(req);
    if (req.body !== undefined) checked(Empty, req.body);
    await service.closeTerminal(serverId, terminalId);
    return reply.code(204).send();
  });
  app.addHook('preClose', () => {
    service.dispose();
  });
}
