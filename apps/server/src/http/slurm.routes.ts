import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TerminalTargetSchema } from '@ssh-server/shared';
import { ResourceTargetError } from '../resources/target';
import type { SlurmService } from '../slurm/service';
import { requestSignal } from './remote-files.routes';

const Query = z.strictObject({ target: z.string() });
export function registerSlurmRoutes(app: FastifyInstance, slurm: SlurmService): void {
  app.get<{ Params: { id: string } }>('/api/workspaces/:id/slurm', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const query = Query.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ message: '需要固定的 Slurm 查询目标' });
    let input: unknown;
    try {
      input = JSON.parse(query.data.target);
    } catch {
      return reply.code(400).send({ message: 'Slurm 查询目标不合法' });
    }
    const target = TerminalTargetSchema.safeParse(input);
    if (!target.success || target.data.workspaceId !== req.params.id)
      return reply.code(400).send({ message: 'Slurm 查询目标不合法' });
    try {
      return await slurm.get(target.data, requestSignal(req, reply));
    } catch (error) {
      if (error instanceof ResourceTargetError)
        return reply.code(error.code === 'workspace_missing' ? 404 : 409).send({
          code: error.code,
          message: error.code === 'workspace_missing' ? '工作区不存在' : '工作区连接或目录已变化，请重新打开作业摘要',
        });
      return reply
        .code(502)
        .send({ code: 'slurm_unavailable', message: 'Slurm 作业摘要读取失败，请检查 SSH 连接后重试' });
    }
  });
  app.addHook('preClose', () => {
    slurm.dispose();
  });
}
