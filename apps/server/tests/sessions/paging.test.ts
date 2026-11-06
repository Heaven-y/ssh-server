import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createSessionsService } from '../../src/sessions/service';
import type { SessionProvider } from '../../src/agents/contracts';

function fixture() {
  const project = { id: 'demo', name: '演示项目', dir: path.resolve('fixtures', 'demo') };
  const rows = Array.from({ length: 125 }, (_, i) => ({
    sessionId: `s${i}`,
    summary: `任务${i}`,
    lastModified: 200 - i,
    cwd: project.dir,
  }));
  const list = vi.fn(async () => rows);
  const page = vi.fn(async (_dir: string, options: { cursor?: string; limit: number }) => {
    const offset = Number(options.cursor ?? 0);
    const items = rows.slice(offset, offset + options.limit);
    return { items, nextCursor: offset + items.length < rows.length ? String(offset + items.length) : undefined };
  });
  const provider = {
    list,
    page,
    mutate: vi.fn(),
    assertBelongs: async () => project.dir,
  } as unknown as SessionProvider;
  const service = createSessionsService(
    { claude: provider },
    {
      projects: async () => [project],
      withIdleSession: (_s, op) => op(),
    },
  );
  return { service, page, list, rows };
}

it('首屏只读一页，后续按需加载；同来源列表复用原生页', async () => {
  const f = fixture();
  const first = await f.service.page({ agent: 'claude', scope: 'active' });
  expect(first.items).toHaveLength(50);
  expect(f.page).toHaveBeenCalledTimes(1);
  expect(f.list).not.toHaveBeenCalled();
  const again = await f.service.page({ agent: 'claude', scope: 'active', projectId: 'demo' });
  expect(again.items[0]?.sessionId).toBe('s0');
  expect(f.page).toHaveBeenCalledTimes(1);
  const second = await f.service.page({ agent: 'claude', scope: 'active', cursor: first.nextCursor });
  expect(second.items[0]?.sessionId).toBe('s50');
  expect(f.page).toHaveBeenCalledTimes(2);
});

it('搜索覆盖未加载的旧会话和项目名称，游标不能跨筛选条件复用', async () => {
  const f = fixture();
  const found = await f.service.page({ agent: 'claude', scope: 'active', search: '任务124' });
  expect(found.items.map((item) => item.sessionId)).toEqual(['s124']);
  const project = await f.service.page({ agent: 'claude', scope: 'active', search: '演示项目' });
  expect(project.items).toHaveLength(50);
  expect((await f.service.page({ agent: 'claude', scope: 'active', search: 'Claude Code' })).items).toHaveLength(50);
  expect((await f.service.page({ agent: 'claude', scope: 'active', search: 's124' })).items[0]?.sessionId).toBe('s124');
  await expect(
    f.service.page({ agent: 'claude', scope: 'active', search: '别的', cursor: project.nextCursor }),
  ).rejects.toMatchObject({ code: 'session_page_expired' });
});

it('原生变化后作废页和旧游标，重新打开首屏能看见新标题', async () => {
  const f = fixture();
  const first = await f.service.page({ agent: 'claude', scope: 'active' });
  f.rows[0]!.summary = '新标题';
  f.service.invalidate('claude');
  await expect(f.service.page({ agent: 'claude', scope: 'active', cursor: first.nextCursor })).rejects.toMatchObject({
    code: 'session_page_expired',
  });
  const refreshed = await f.service.page({ agent: 'claude', scope: 'active' });
  expect(refreshed.items[0]?.title).toBe('新标题');
  expect(f.page).toHaveBeenCalledTimes(2);
});

it('重新打开页面的读取批次不会复用上次的空首页', async () => {
  const f = fixture();
  f.rows.splice(0);
  expect((await f.service.page({ agent: 'claude', scope: 'active', reader: 'first-window' })).items).toEqual([]);
  f.rows.push({ sessionId: 'new', summary: '原生新增', lastModified: 1, cwd: path.resolve('fixtures', 'demo') });
  const next = await f.service.page({ agent: 'claude', scope: 'active', reader: 'reopened-window' });
  expect(next.items[0]?.sessionId).toBe('new');
  expect(f.page).toHaveBeenCalledTimes(2);
});

it('筛选跨度很大时返回可继续的空页，不把扫描预算误当搜索结束', async () => {
  const f = fixture();
  for (let index = 125; index < 510; index++)
    f.rows.push({ ...f.rows[0]!, sessionId: `s${index}`, summary: `任务${index}`, lastModified: -index });
  const first = await f.service.page({ agent: 'claude', scope: 'active', search: '任务509' });
  expect(first.items).toEqual([]);
  expect(first.nextCursor).toBeTruthy();
  expect(f.page).toHaveBeenCalledTimes(8);
  const second = await f.service.page({
    agent: 'claude',
    scope: 'active',
    search: '任务509',
    cursor: first.nextCursor,
  });
  expect(second.items.map((item) => item.sessionId)).toEqual(['s509']);
});
