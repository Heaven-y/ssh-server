import { expect, it } from 'vitest';
import { createCliActivity } from '../../src/bootstrap/cli-activity';

it('安装排斥在途原生读取，维护期间拒绝同来源新读取，其他 CLI 保持可用', async () => {
  const activity = createCliActivity();
  let release!: () => void;
  const pending = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const reading = activity.run('antigravity', pending);
  await expect(activity.exclusive('antigravity', async () => undefined)).rejects.toMatchObject({ code: 'agent_busy' });
  release();
  await reading;
  const installing = activity.exclusive('antigravity', pending);
  await expect(activity.run('antigravity', async () => undefined)).rejects.toMatchObject({ code: 'agent_busy' });
  await expect(activity.run('codex', async () => 'ok')).resolves.toBe('ok');
  release();
  await installing;
  await expect(activity.exclusive('antigravity', () => Promise.reject(new Error('fixture')))).rejects.toThrow(
    'fixture',
  );
  await expect(activity.run('antigravity', async () => 'ok')).resolves.toBe('ok');
});
