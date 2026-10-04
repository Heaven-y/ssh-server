import type { FileEditorMessage, FileEditorServerMessage, FileEditorState } from '@ssh-server/shared';

/** 锁定与最新状态均在消息回调中同步更新，避免等待 React 渲染产生编辑竞态。 */
export function createEditorConnection(workspaceId: string, changed: (message: string) => void) {
  const id = crypto.randomUUID();
  let state: FileEditorState = { path: null, dirty: false, busy: false };
  let socket: WebSocket;
  let token: string | undefined;
  let ready = false;
  let closed = false;
  let discardApproved = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const send = (message: FileEditorMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const update = (value: FileEditorState) => {
    state = value;
    if (ready) send({ type: 'state', state });
  };
  function message(event: MessageEvent<string>) {
    const incoming = JSON.parse(event.data) as FileEditorServerMessage;
    if (incoming.type === 'ready') {
      ready = true;
      token = undefined;
      send({ type: 'state', state });
      changed('');
    }
    if (incoming.type === 'reserve') {
      token = incoming.token;
      changed('服务器文件操作正在协调，编辑暂时锁定；当前内容已保留。');
      send({ type: 'reserved', token, state });
    }
    if (incoming.type === 'unlock' && incoming.token === token) {
      token = undefined;
      changed('');
    }
    if (incoming.type === 'error') changed(incoming.message);
  }
  function connect() {
    if (closed) return;
    const url = new URL(`/api/workspaces/${encodeURIComponent(workspaceId)}/file-editors/${id}`, location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    socket.onmessage = message;
    socket.onclose = () => {
      ready = false;
      if (closed) return;
      changed('编辑保护连接中断，内容已保留；重连完成后才能继续编辑或保存。');
      retry = setTimeout(connect, 1500);
    };
    socket.onerror = () => socket.close();
  }
  connect();
  return {
    update,
    canEdit: () => ready && !token && !closed,
    isReserved: () => !!token,
    approveClose: () => {
      discardApproved = true;
    },
    dispose() {
      closed = true;
      clearTimeout(retry);
      if (!state.busy && (!state.dirty || discardApproved)) send({ type: 'release' });
      socket.close();
    },
  };
}
export type EditorConnection = ReturnType<typeof createEditorConnection>;
