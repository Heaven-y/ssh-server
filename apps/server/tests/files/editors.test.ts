import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { FileEditorState } from '@ssh-server/shared';
import { createFileEditors, type EditorPeer } from '../../src/files/editors';
import type { PreparedAction } from '../../src/remote-files/preflight';

const temps: string[] = [];
afterEach(async () => {
  for (const directory of temps.splice(0)) await rm(directory, { recursive: true, force: true });
});
const action = { public: { affectedWorkspaces: [{ id: 'a' }] } } as PreparedAction;
const signal = () => new AbortController().signal;

it('预留握手读取最新脏状态；锁定期间新编辑器不能登记，释放后可继续', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'file-editor-core-'));
  temps.push(directory);
  const editors = createFileEditors(directory);
  const id = randomUUID();
  let latest: FileEditorState = { path: 'code.py', dirty: false, busy: false };
  const peer: EditorPeer = {
    send: (message) => {
      if (message.type === 'reserve')
        void editors.receive(id, peer, { type: 'reserved', token: message.token, state: latest });
    },
  };
  await editors.attach(id, 'a', peer);
  await editors.receive(id, peer, { type: 'state', state: latest });
  latest = { ...latest, dirty: true };
  await expect(editors.reserve(action, signal())).rejects.toMatchObject({ code: 'editor_dirty' });
  latest = { ...latest, dirty: false };
  const release = await editors.reserve(action, signal());
  await expect(editors.attach(randomUUID(), 'a', { send: () => undefined })).rejects.toMatchObject({
    code: 'editor_locked',
  });
  release();
  await editors.receive(id, peer, { type: 'release' });
  expect(JSON.parse(await readFile(path.join(directory, 'file-editors.json'), 'utf8'))).toEqual([]);
});

it('断线和重启保留未知登记；重连或明确放弃才能解除门槛，正文不持久化', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'file-editor-restart-'));
  temps.push(directory);
  const id = randomUUID();
  const peer: EditorPeer = { send: () => undefined };
  const first = createFileEditors(directory);
  await first.attach(id, 'a', peer);
  await first.receive(id, peer, { type: 'state', state: { path: 'private-code.py', dirty: true, busy: false } });
  first.detach(id, peer);
  await expect(first.reserve(action, signal())).rejects.toMatchObject({ code: 'editor_unavailable' });
  const stored = await readFile(path.join(directory, 'file-editors.json'), 'utf8');
  expect(stored).not.toContain('private-code');
  const restarted = createFileEditors(directory);
  expect(await restarted.disconnected('a')).toEqual([id]);
  await expect(restarted.reserve(action, signal())).rejects.toMatchObject({ code: 'editor_unavailable' });
  await restarted.attach(id, 'a', peer);
  await expect(restarted.forget('a', id)).rejects.toMatchObject({ code: 'editor_unavailable' });
  restarted.detach(id, peer);
  await restarted.forget('a', id);
  const release = await restarted.reserve(action, signal());
  release();
  expect(await restarted.disconnected('a')).toEqual([]);
});
