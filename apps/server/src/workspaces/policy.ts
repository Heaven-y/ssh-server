import { createHash } from 'node:crypto';
import {
  WorkspacePolicySchema,
  type Workspace,
  type WorkspacePolicyDocument,
  type WorkspacePolicyInput,
} from '@ssh-server/shared';
import type { WorkspaceStore } from './store';

export class WorkspacePolicyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const revision = (workspace: Workspace) => createHash('sha256').update(JSON.stringify(workspace)).digest('hex');
function document(workspace: Workspace): WorkspacePolicyDocument {
  const parsed = WorkspacePolicySchema.safeParse(workspace.policy ?? {});
  if (!parsed.success)
    throw new WorkspacePolicyError(503, 'policy_invalid', '工作区命令规则损坏，请检查本机配置文件；原配置已保留');
  return { policy: parsed.data, revision: revision(workspace) };
}
const missing = () => new WorkspacePolicyError(404, 'workspace_missing', '工作区不存在');

export function createWorkspacePolicy(store: WorkspaceStore) {
  return {
    async read(id: string): Promise<WorkspacePolicyDocument> {
      const workspace = await store.get(id);
      if (!workspace) throw missing();
      return document(workspace);
    },
    async save(id: string, input: WorkspacePolicyInput): Promise<WorkspacePolicyDocument> {
      const workspace = await store.update(id, { policy: input.policy }, (current) => {
        if (revision(current) !== input.revision)
          throw new WorkspacePolicyError(409, 'policy_changed', '工作区配置已变化，请保留修改并重新读取后核对');
      });
      if (!workspace) throw missing();
      return document(workspace);
    },
  };
}
export type WorkspacePolicyService = ReturnType<typeof createWorkspacePolicy>;
