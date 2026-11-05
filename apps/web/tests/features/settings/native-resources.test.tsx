// @vitest-environment jsdom
import { EditorView } from '@uiw/react-codemirror';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { ProductSettingsSchema, type NativeResourceCatalog } from '@agentdeck/shared';
import SettingsDialog from '../../../src/features/settings/SettingsDialog';
import { queryClient } from '../../../src/lib/query-client';

const project = { id: 'demo', name: '演示项目', dir: '~/projects/demo' };
const resource = {
  id: 'project-rules',
  agent: 'antigravity',
  kind: 'rules',
  scope: 'project',
  label: '项目规则',
  displayPath: '~/projects/demo/.agents/rules/main.md',
  format: 'markdown',
  exists: true,
  editable: true,
  description: '该项目的原生规则。',
} as const;
const catalog: NativeResourceCatalog = {
  agent: 'antigravity',
  projectId: project.id,
  entries: [resource],
  roots: [
    {
      id: 'project-skills',
      kind: 'skills',
      scope: 'project',
      label: '项目 Skills',
      displayPath: '~/projects/demo/.agents/skills',
      editable: true,
    },
  ],
  guidance: [{ label: '原生插件', description: '使用 CLI 管理插件。', command: 'antigravity plugin list' }],
  warnings: [],
};
let fetchMock: MockInstance<typeof fetch>;
const requests: Array<{ url: string; init?: RequestInit }> = [];

function editor() {
  return EditorView.findFromDOM(screen.getByRole('textbox', { name: '原生文件内容' }))!;
}
function edit(content: string) {
  const view = editor();
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } }));
}
async function openCatalog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Antigravity' }));
  fireEvent.click(await screen.findByRole('button', { name: '修改 Antigravity 原始配置' }));
  return screen.findByRole('heading', { name: '原生配置与扩展 · Antigravity' });
}
beforeEach(() => {
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  requests.length = 0;
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input as string;
    requests.push({ url, init });
    if (url === '/api/settings/product')
      return Response.json({ settings: ProductSettingsSchema.parse({}), revision: 'missing' });
    if (url.startsWith('/api/settings/models/'))
      return Response.json({
        agent: url.split('/').at(-1),
        revision: 'missing',
        displayPath: 'settings.json',
        fields: [],
        warnings: [],
      });
    if (init?.method === 'PUT') return Response.json({ resource, revision: 'next' });
    if (url.includes('/open?'))
      return Response.json({ resource, content: '# synthetic-private-rule\n', revision: 'original' });
    if (url.startsWith('/api/native-resources/')) return Response.json(catalog);
    throw new Error(`未声明的测试接口：${url}`);
  });
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(async () => {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

it('三个 CLI 共用资源入口，目录只取当前项目元数据，显式打开才读取正文且不缓存', async () => {
  render(<SettingsDialog project={project} onClose={vi.fn()} />);
  await openCatalog();
  await screen.findByText(resource.displayPath);
  expect(requests.some(({ url }) => url === '/api/native-resources/antigravity?projectId=demo')).toBe(true);
  expect(requests.some(({ url }) => url.includes('/open'))).toBe(false);
  expect(screen.queryByRole('textbox', { name: '原生文件内容' })).toBeNull();
  expect(screen.getByText('antigravity plugin list')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '显示并编辑 项目规则' }));
  await screen.findByRole('textbox', { name: '原生文件内容' });
  expect(editor().state.doc.toString()).toBe('# synthetic-private-rule\n');
  expect(requests.find(({ url }) => url.includes('/open'))).toMatchObject({
    url: '/api/native-resources/antigravity/project-rules/open?projectId=demo',
    init: { method: 'POST', cache: 'no-store' },
  });
  expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain('synthetic-private-rule');
  fireEvent.click(screen.getByRole('button', { name: '返回资源目录' }));
  await screen.findByRole('heading', { name: '原生配置与扩展 · Antigravity' });
  expect(screen.queryByRole('textbox', { name: '原生文件内容' })).toBeNull();
});

it('保存使用原修订，冲突保留正文；关闭、重读均保护未保存草稿', async () => {
  const close = vi.fn();
  const handle = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) =>
    init?.method === 'PUT'
      ? Response.json({ message: '文件已变化，请重新读取。' }, { status: 409 })
      : handle(input, init),
  );
  render(<SettingsDialog project={project} onClose={close} />);
  await openCatalog();
  fireEvent.click(await screen.findByRole('button', { name: '显示并编辑 项目规则' }));
  await screen.findByRole('textbox', { name: '原生文件内容' });
  edit('# 我的规则\n');
  fireEvent.click(screen.getByRole('button', { name: '保存文件' }));
  await screen.findByRole('alert');
  expect(editor().state.doc.toString()).toBe('# 我的规则\n');
  const save = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(save[1]?.body as string)).toEqual({ content: '# 我的规则\n', revision: 'original' });
  fireEvent.click(screen.getByRole('button', { name: '重新读取文件' }));
  expect(requests.filter(({ url }) => url.includes('/open'))).toHaveLength(1);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('textbox', { name: '原生文件内容' })).toBeNull();
});

it('离开取消请求并忽略迟到的敏感内容', async () => {
  const handle = fetchMock.getMockImplementation()!;
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementation(async (input, init) =>
    (input as string).includes('/open?')
      ? new Promise((done) => {
          resolve = done;
        })
      : handle(input, init),
  );
  const mounted = render(<SettingsDialog project={project} onClose={vi.fn()} />);
  await openCatalog();
  fireEvent.click(await screen.findByRole('button', { name: '显示并编辑 项目规则' }));
  await screen.findByText('正在读取文件…');
  const open = fetchMock.mock.calls.find(([url]) => (url as string).includes('/open?'))!;
  mounted.unmount();
  expect(open[1]?.signal?.aborted).toBe(true);
  await act(async () => resolve(Response.json({ resource, content: 'late-sensitive-content', revision: 'late' })));
  expect(screen.queryByRole('textbox')).toBeNull();
  await waitFor(() => expect(screen.queryByText('late-sensitive-content')).toBeNull());
});

it('只在服务端给出的Skill目录创建；正文带用户填写的元信息，创建成功不重复提交', async () => {
  const handle = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) =>
    init?.method === 'POST' && !(input as string).includes('/open?')
      ? Response.json({
          resource: {
            ...resource,
            id: 'new-skill',
            kind: 'skills',
            displayPath: '~/projects/demo/.agents/skills/demo-skill/SKILL.md',
          },
          revision: 'saved',
        })
      : handle(input, init),
  );
  render(<SettingsDialog project={project} onClose={vi.fn()} />);
  await openCatalog();
  fireEvent.click(await screen.findByRole('button', { name: '在项目 Skills中新建 Skill' }));
  const name = await screen.findByLabelText('Skill 名称');
  fireEvent.change(screen.getByLabelText('Skill 用途'), { target: { value: '检查演示项目' } });
  const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Skill 使用说明' }))!;
  act(() => view.dispatch({ changes: { from: 0, insert: '# 检查要求\n先阅读项目说明。' } }));
  for (const invalid of ['Demo Skill', 'demo--skill', 'demo-', 'a'.repeat(65)]) {
    fireEvent.change(name, { target: { value: invalid } });
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '创建文件' }).disabled).toBe(true);
  }
  fireEvent.change(name, { target: { value: 'demo-skill' } });
  expect(name.getAttribute('aria-invalid')).not.toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '创建文件' }));
  await screen.findByText(/已创建：/);
  const created = fetchMock.mock.calls.find(
    ([url, init]) => (url as string).startsWith('/api/native-resources/') && init?.method === 'POST',
  )!;
  expect(created[0]).toBe('/api/native-resources/antigravity?projectId=demo');
  expect(JSON.parse(created[1]?.body as string)).toEqual({
    rootId: 'project-skills',
    name: 'demo-skill',
    content: '---\nname: "demo-skill"\ndescription: "检查演示项目"\n---\n\n# 检查要求\n先阅读项目说明。',
  });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '创建文件' }).disabled).toBe(true);
});
