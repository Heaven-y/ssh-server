import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSummaries } from '../../../src/agents/antigravity/summaries';
import { createAntigravitySessions } from '../../../src/agents/antigravity/sessions';

type FixtureRow = {
  id: string | null;
  title: string | null;
  preview: string | null;
  uris: string | null;
  time: string | null;
};

const COLUMNS = 'conversation_id, title, preview, last_modified_time, workspace_uris';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agentdeck-antigravity-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function fixturePath(name = 'conversation_summaries'): string {
  return path.join(root, `${name}-${randomUUID()}.db`);
}

/** 造一个与 Antigravity 实测表同形的合成库，不写入任何真实会话内容。 */
async function makeFixtureDb(rows: FixtureRow[]): Promise<string> {
  const dbPath = fixturePath();
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`create table conversation_summaries (${COLUMNS}, primary key (conversation_id))`);
    const insert = db.prepare(
      'insert into conversation_summaries (conversation_id, title, preview, last_modified_time, workspace_uris) values (?, ?, ?, ?, ?)',
    );
    for (const row of rows) insert.run(row.id, row.title, row.preview, row.time, row.uris);
  } finally {
    db.close();
  }
  return dbPath;
}

/** 只有别的表，缺少 conversation_summaries。 */
async function makeEmptyDb(): Promise<string> {
  const dbPath = fixturePath('empty');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('create table something_else (id text)');
  } finally {
    db.close();
  }
  return dbPath;
}

/** 允许 NULL 的表，用来验证坏行只会被跳过而不会让整个列表失败。 */
async function makeNullableDb(rows: FixtureRow[]): Promise<string> {
  const dbPath = fixturePath('nullable');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`create table conversation_summaries (${COLUMNS})`);
    const insert = db.prepare(
      'insert into conversation_summaries (conversation_id, title, preview, last_modified_time, workspace_uris) values (?, ?, ?, ?, ?)',
    );
    for (const row of rows) insert.run(row.id, row.title, row.preview, row.time, row.uris);
  } finally {
    db.close();
  }
  return dbPath;
}

const sampleRow: FixtureRow = {
  id: 'c1',
  title: '示例会话',
  preview: '示例预览',
  uris: 'file:///E:/web/demo',
  time: '2026-11-03 12:00:00',
};

describe('Antigravity 会话摘要读取', () => {
  it('读出会话 id、标题、时间与 workspace_uris', async () => {
    const dbPath = await makeFixtureDb([sampleRow]);
    const rows = readSummaries(dbPath);
    expect(rows).toEqual([
      {
        conversationId: 'c1',
        title: '示例会话',
        workspaceUris: 'file:///E:/web/demo',
        lastModified: '2026-11-03 12:00:00',
        preview: '示例预览',
      },
    ]);
  });

  it('按最后修改时间倒序返回', async () => {
    const dbPath = await makeFixtureDb([
      { ...sampleRow, id: 'old', time: '2026-11-01 08:00:00' },
      { ...sampleRow, id: 'new', time: '2026-11-04 09:30:00' },
      { ...sampleRow, id: 'middle', time: '2026-11-02 10:00:00' },
    ]);
    expect(readSummaries(dbPath).map((row) => row.conversationId)).toEqual(['new', 'middle', 'old']);
  });

  it('库文件不存在时返回空数组而不抛错', () => {
    expect(readSummaries(path.join(tmpdir(), 'agentdeck-no-such.db'))).toEqual([]);
  });

  it('表结构不符时返回空数组', async () => {
    const dbPath = await makeEmptyDb();
    expect(readSummaries(dbPath)).toEqual([]);
  });

  it('不是 SQLite 文件时返回空数组', async () => {
    const dbPath = fixturePath('broken');
    await writeFile(dbPath, '这不是数据库', 'utf8');
    expect(readSummaries(dbPath)).toEqual([]);
  });

  it('空表返回空数组', async () => {
    const dbPath = await makeFixtureDb([]);
    expect(readSummaries(dbPath)).toEqual([]);
  });

  it('跳过缺少会话 id 或时间的坏行，可空字段降级为空串', async () => {
    const dbPath = await makeNullableDb([
      { ...sampleRow, id: null },
      { ...sampleRow, id: 'no-time', time: null },
      { ...sampleRow, id: 'nulls', title: null, preview: null, uris: null },
    ]);
    expect(readSummaries(dbPath)).toEqual([
      { conversationId: 'nulls', title: '', workspaceUris: '', lastModified: '2026-11-03 12:00:00', preview: '' },
    ]);
  });

  it('排除子会话与对战行，只列用户自己的会话', async () => {
    // 表里除用户会话外还有 CLI 内部产物：子代理会话、候选对战。它们不该出现在会话列表里。
    const dbPath = fixturePath('mixed');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(
        `create table conversation_summaries (${COLUMNS}, parent_conversation_id text, nesting_depth integer, battle_id text, primary key (conversation_id))`,
      );
      const insert = db.prepare(
        'insert into conversation_summaries (conversation_id, title, preview, last_modified_time, workspace_uris, parent_conversation_id, nesting_depth, battle_id) values (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const at = '2026-11-03 12:00:00';
      insert.run('user-1', '用户会话', '', at, 'file:///E:/web/demo', '', 0, '');
      insert.run('child-1', '子会话', '', at, 'file:///E:/web/demo', 'user-1', 1, '');
      insert.run('nested-1', '深层子会话', '', at, 'file:///E:/web/demo', '', 2, '');
      insert.run('battle-1', '对战候选', '', at, 'file:///E:/web/demo', '', 0, 'battle-x');
    } finally {
      db.close();
    }
    expect(readSummaries(dbPath).map((row) => row.conversationId)).toEqual(['user-1']);
  });

  it('表里没有子会话相关列时照常读取，不因缺列变空', async () => {
    // 不同版本的 CLI 维护的表结构可能不同；缺列时退化为不做该维度过滤，而不是整表读不出来。
    const dbPath = await makeFixtureDb([{ ...sampleRow, id: 'only' }]);
    expect(readSummaries(dbPath)).toHaveLength(1);
  });
});

describe('Antigravity 会话提供方', () => {
  const dir = path.join(tmpdir(), 'agentdeck-fixture', 'demo');

  it('把摘要映射为原生会话行并原样带出 workspaceUris', async () => {
    const provider = createAntigravitySessions({
      readSummaries: () => [
        {
          conversationId: 'c1',
          title: '示例会话',
          workspaceUris: 'file:///E:/web/demo',
          lastModified: '2026-11-03 12:00:00',
          preview: '示例预览',
        },
      ],
    });
    await expect(provider.list(dir)).resolves.toEqual([
      {
        sessionId: 'c1',
        summary: '示例会话',
        lastModified: Date.parse('2026-11-03T12:00:00Z'),
        workspaceUris: 'file:///E:/web/demo',
      },
    ]);
  });

  it('空标题替换为占位文案', async () => {
    const provider = createAntigravitySessions({
      readSummaries: () => [
        {
          conversationId: 'c1',
          title: '   ',
          workspaceUris: '',
          lastModified: '2026-11-03 12:00:00',
          preview: '',
        },
      ],
    });
    const [item] = await provider.list(dir);
    expect(item?.summary).toBe('未命名会话');
  });

  it('时间无法解析时回退为 0 而不是抛错', async () => {
    const provider = createAntigravitySessions({
      readSummaries: () => [
        {
          conversationId: 'c1',
          title: '示例会话',
          workspaceUris: '',
          lastModified: '不是时间',
          preview: '',
        },
      ],
    });
    const [item] = await provider.list(dir);
    expect(item?.lastModified).toBe(0);
  });

  it.each([
    ['秒级整数时间戳', '1762000000', 1762000000000],
    ['毫秒级整数时间戳', '1762000000000', 1762000000000],
    // 12/14 位等非标准长度也按数量级猜，不能静默落到 1970。
    ['12 位按毫秒处理', '176200000000', 176200000000],
    ['14 位按毫秒处理', '17620000000000', 17620000000000],
  ])('%s 也能解析，不至于整列显示 1970', async (_label, stored, expected) => {
    // 列声明是 datetime，但 SQLite 类型宽松；真存成数字时不能拼 Z 直接变 NaN。
    const provider = createAntigravitySessions({
      readSummaries: () => [
        { conversationId: 'c1', title: '示例会话', workspaceUris: '', lastModified: stored, preview: '' },
      ],
    });
    const [item] = await provider.list(dir);
    expect(item?.lastModified).toBe(expected);
  });

  it('汇总读取抛错时列表仍然为空', async () => {
    const provider = createAntigravitySessions({
      readSummaries: () => {
        throw new Error('锁冲突');
      },
    });
    await expect(provider.list(dir)).resolves.toEqual([]);
  });

  it('归档列表按不支持处理', async () => {
    const provider = createAntigravitySessions({ readSummaries: () => [] });
    await expect(provider.list(dir, undefined, true)).rejects.toMatchObject({
      status: 400,
      code: 'unsupported_action',
    });
  });

  it('read 明确报告历史不可读', async () => {
    const provider = createAntigravitySessions({ readSummaries: () => [] });
    await expect(provider.read('c1', dir)).rejects.toThrow(/无法读取/);
    await expect(provider.read('c1', dir)).rejects.toMatchObject({
      status: 501,
      code: 'session_not_replayable',
    });
  });

  it('mutate 与 fork 按不支持处理', async () => {
    const provider = createAntigravitySessions({ readSummaries: () => [] });
    await expect(provider.mutate('c1', dir, { action: 'delete', confirmed: true })).rejects.toMatchObject({
      status: 400,
      code: 'unsupported_action',
    });
    await expect(provider.fork('c1', dir, {})).rejects.toMatchObject({
      status: 400,
      code: 'unsupported_action',
    });
  });

  it('assertBelongs 仅放行存在且属于当前项目的会话', async () => {
    const provider = createAntigravitySessions({
      readSummaries: () => [
        {
          conversationId: 'c1',
          title: '示例会话',
          workspaceUris: pathToFileURL(dir).href,
          lastModified: '2026-11-03 12:00:00',
          preview: '',
        },
      ],
    });
    await expect(provider.assertBelongs('c1', dir)).resolves.toBeUndefined();
    await expect(provider.assertBelongs('c1', path.join(dir, 'other'))).rejects.toMatchObject({
      status: 404,
      code: 'session_missing',
    });
    await expect(provider.assertBelongs('missing', dir)).rejects.toMatchObject({
      status: 404,
      code: 'session_missing',
    });
  });
});
