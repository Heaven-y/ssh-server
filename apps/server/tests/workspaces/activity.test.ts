import { expect, it } from 'vitest';
import { createWorkspaceActivity } from '../../src/workspaces/activity';

it('项目管理排斥活动与新的租约，完成后允许重新使用', async () => {
  const activity = createWorkspaceActivity();
  const release = activity.acquire('project');
  await expect(activity.withIdle('project', async () => true)).rejects.toThrow();
  release();
  let finish!: () => void;
  const pending = activity.withIdle(
    'project',
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  expect(() => activity.acquire('project')).toThrow();
  const releaseOther = activity.acquire('other');
  releaseOther();
  finish();
  await pending;
  const after = activity.acquire('project');
  after();
});
