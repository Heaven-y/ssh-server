// 项目接口：项目 = 本地目录 + 可选的服务器默认值；管理本地记录，不修改目录和原生会话。
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { WorkspaceInput } from '@agentdeck/shared/projects';
import { WorkspaceStorageError, WorkspaceValidationError, type WorkspaceStore } from '../workspaces/store';
import { WorkspaceBusyError, type WorkspaceActivity } from '../workspaces/activity';

const Params = z.object({ id: z.string().min(1) });
// JSON 里没有 undefined：null 表示「清除这个字段」，没传的键表示「不要动它」。
// 所以这里只判断键是否存在，再把 null 转成 undefined 交给 store，绝不整体透传。
const PatchBody = z.object({
  name: z.string().optional(),
  dir: z.string().optional(),
  server: z.string().nullable().optional(),
  remoteDir: z.string().nullable().optional(),
});
type PatchInput = z.infer<typeof PatchBody>;

export type ProjectRoutesDeps = {
  store: WorkspaceStore;
  activity?: WorkspaceActivity;
};

/** 把 store 的字段级校验错误映射成 400 + field，存储损坏统一按 503 上报。 */
async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkspaceBusyError)
      return reply.code(409).send({ code: 'project_busy', message: error.message });
    if (error instanceof WorkspaceValidationError)
      return reply.code(400).send({ code: 'invalid_project', message: error.message, field: error.field });
    if (error instanceof WorkspaceStorageError)
      return reply.code(503).send({ code: 'project_storage_failed', message: error.message });
    throw error;
  }
}

function invalid(reply: FastifyReply, message: string) {
  reply.header('Cache-Control', 'no-store');
  return reply.code(400).send({ code: 'invalid_project', message });
}

function missing(reply: FastifyReply) {
  return reply.code(404).send({ code: 'workspace_missing', message: '项目不存在' });
}

/**
 * 只收集请求体里真正出现的键：
 * - { name } 只改名字，绑定与目录都不动；
 * - { server: null, remoteDir: null } 同时解绑，退回纯本地项目；
 * - { server: null } 只解绑一半，交给 store 按「同进同退」拒绝（400）。
 */
function toPatch(body: PatchInput): Partial<WorkspaceInput> {
  const patch: Partial<WorkspaceInput> = {};
  if ('name' in body) patch.name = body.name;
  if ('dir' in body) patch.dir = body.dir;
  if ('server' in body) patch.server = body.server ?? undefined;
  if ('remoteDir' in body) patch.remoteDir = body.remoteDir ?? undefined;
  return patch;
}

export function registerProjectRoutes(app: FastifyInstance, deps: ProjectRoutesDeps): void {
  const listProjects = () => deps.store.list();
  const withIdle = <T>(id: string, operation: () => Promise<T>) =>
    deps.activity ? deps.activity.withIdle(id, operation) : operation();

  app.get('/api/projects', (_req, reply) => respond(reply, listProjects));

  app.post('/api/projects', (req, reply) => {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body))
      return invalid(reply, '项目请求格式不正确');
    // 字段校验交给 store，错误带 field 返回；这里只挡明显不是对象的请求体。
    return respond(reply, () => deps.store.create(req.body as WorkspaceInput));
  });

  app.patch('/api/projects/:id', (req, reply) => {
    const params = Params.safeParse(req.params);
    const body = PatchBody.safeParse(req.body);
    if (!params.success || !body.success) return invalid(reply, '项目修改格式不正确');
    return respond(reply, async () => {
      const update = () => deps.store.update(params.data.id, toPatch(body.data));
      const updated = body.data.dir === undefined ? await update() : await withIdle(params.data.id, update);
      return updated ?? missing(reply);
    });
  });

  app.delete('/api/projects/:id', (req, reply) => {
    const params = Params.safeParse(req.params);
    if (!params.success) return invalid(reply, '项目请求格式不正确');
    return respond(reply, async () => {
      // 删除只移除本工具的配置，不碰项目目录；已打开的终端与面板不会因此被关闭。
      if (!(await withIdle(params.data.id, () => deps.store.remove(params.data.id)))) return missing(reply);
      return reply.code(204).send();
    });
  });
}
