import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';
import type { Attributes, Connection, FileEntry, SFTPWrapper } from 'ssh2';
import type { RemoteBrowseTarget, Workspace } from '@ssh-server/shared';
import { createSshPool } from '../../src/ssh/pool';

type Operation = 'READDIR' | 'REALPATH' | 'SFTP' | 'READ';
type Gate = { entered(): void; action?: () => void };
const REMOTE_HOME = path.posix.join(path.posix.sep, 'fixture-home');
const PASSWORD = 'fixture-secret';
const PRIVATE_DIAGNOSTIC = 'private-fixture-diagnostic';

function attributes(mode: number, size = 0): Attributes {
  return { mode, size, uid: 1000, gid: 1000, atime: 1_700_000_000, mtime: 1_700_000_000 };
}
function entry(filename: string, mode = 0o100644, size = 12): FileEntry {
  return { filename, longname: filename, attrs: attributes(mode, size) };
}

/** 真实 ssh2 协议替身，只提供内存元数据；不访问远端或开发机项目文件。 */
export async function startRemoteSftpFixture(options: { downloads?: boolean } = {}) {
  const home = REMOTE_HOME;
  const root = path.posix.join(home, 'projects', 'demo');
  const outside = path.posix.join(home, 'datasets');
  const denied = path.posix.join(home, 'restricted');
  const slow = path.posix.join(home, 'slow');
  const nodes = new Map<string, FileEntry[]>();
  nodes.set(path.posix.sep, [entry('fixture-home', 0o040755)]);
  nodes.set(home, [entry('projects', 0o040755), entry('datasets', 0o040755), entry('slow', 0o040755)]);
  nodes.set(path.posix.dirname(root), [entry('demo', 0o040755)]);
  nodes.set(root, [
    entry('.hidden.py'),
    entry('train.py'),
    entry('weights.bin', 0o100644, 4 * 1024 ** 2),
    entry('scripts', 0o040755),
    entry('dataset-link', 0o120777),
    entry('CON.py'),
  ]);
  nodes.set(path.posix.join(root, 'scripts'), [entry('run.py')]);
  nodes.set(
    outside,
    Array.from({ length: 237 }, (_, index) => entry(`sample-${String(index).padStart(3, '0')}.bin`)),
  );
  nodes.set(slow, [entry('delayed.py')]);
  const bodies = options.downloads
    ? new Map([
        [path.posix.join(root, 'train.py'), Buffer.from('print(1)\nabc')],
        [path.posix.join(root, 'weights.bin'), Buffer.alloc(4 * 1024 ** 2, 42)],
      ])
    : new Map<string, Buffer>();
  const peers = new Set<Connection>();
  const channels = new Set<SFTPWrapper>();
  const handles = new Set<string>();
  const gates = new Map<Operation, Gate>();
  const held = new Set<Gate>();
  const audit = {
    connections: 0,
    authentications: 0,
    channelsOpened: 0,
    channelsClosed: 0,
    handlesOpened: 0,
    handlesClosed: 0,
    bodyReads: 0,
    bytesRead: 0,
    commands: 0,
    requests: [] as string[],
  };
  let handleId = 0;

  function dispatch(operation: Operation, action: () => void) {
    const gate = gates.get(operation);
    if (!gate) return action();
    gates.delete(operation);
    gate.action = action;
    gate.entered();
  }
  function holdNext(operation: Operation) {
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate: Gate = { entered };
    gates.set(operation, gate);
    held.add(gate);
    return {
      entered: pending,
      release() {
        held.delete(gate);
        gate.action?.();
        gate.action = undefined;
      },
    };
  }
  function attachSftp(channel: SFTPWrapper) {
    channels.add(channel);
    audit.channelsOpened++;
    const cursors = new Map<string, { path: string; offset: number }>();
    const files = new Map<string, string>();
    const dropHandle = (id: string) => {
      if (handles.delete(id)) audit.handlesClosed++;
      cursors.delete(id);
      files.delete(id);
    };
    const status = (id: number, code: number) => channel.status(id, code, PRIVATE_DIAGNOSTIC);
    channel.on('error', () => undefined);
    channel.once('close', () => {
      channels.delete(channel);
      audit.channelsClosed++;
      for (const id of cursors.keys()) dropHandle(id);
      for (const id of files.keys()) dropHandle(id);
    });
    channel.on('REALPATH', (id, requested) =>
      dispatch('REALPATH', () => {
        if (!channels.has(channel)) return;
        const resolved = requested === '.' ? home : path.posix.resolve(home, requested);
        audit.requests.push(`REALPATH ${resolved}`);
        channel.name(id, [entry(resolved, 0o040755)]);
      }),
    );
    channel.on('LSTAT', (id, requested) => {
      audit.requests.push(`LSTAT ${requested}`);
      if (requested === denied) return status(id, 3);
      if (nodes.has(requested)) return channel.attrs(id, attributes(0o040755));
      const file = nodes
        .get(path.posix.dirname(requested))
        ?.find((item) => item.filename === path.posix.basename(requested));
      if (file) channel.attrs(id, file.attrs);
      else status(id, 2);
    });
    channel.on('OPENDIR', (id, requested) => {
      audit.requests.push(`OPENDIR ${requested}`);
      if (!nodes.has(requested)) return status(id, 2);
      const key = String(++handleId);
      cursors.set(key, { path: requested, offset: 0 });
      handles.add(key);
      audit.handlesOpened++;
      channel.handle(id, Buffer.from(key));
    });
    channel.on('READDIR', (id, handle) =>
      dispatch('READDIR', () => {
        if (!channels.has(channel)) return;
        const cursor = cursors.get(handle.toString());
        if (!cursor) return status(id, 4);
        audit.requests.push(`READDIR ${cursor.path}`);
        const rows = nodes.get(cursor.path)!.slice(cursor.offset, cursor.offset + 73);
        cursor.offset += rows.length;
        if (rows.length) channel.name(id, rows);
        else status(id, 1);
      }),
    );
    channel.on('CLOSE', (id, handle) => {
      dropHandle(handle.toString());
      status(id, 0);
    });
    channel.on('OPEN', (id, requested, flags) => {
      audit.bodyReads++;
      if (flags !== 1 || !bodies.has(requested)) return status(id, 4);
      const key = String(++handleId);
      files.set(key, requested);
      handles.add(key);
      audit.handlesOpened++;
      channel.handle(id, Buffer.from(key));
    });
    channel.on('FSTAT', (id, handle) => {
      const file = files.get(handle.toString());
      if (!file) return status(id, 4);
      channel.attrs(id, attributes(0o100644, bodies.get(file)!.length));
    });
    channel.on('READ', (id, handle, offset, length) =>
      dispatch('READ', () => {
        if (!channels.has(channel)) return;
        audit.bodyReads++;
        const file = files.get(handle.toString());
        if (!file) return status(id, 4);
        const body = bodies.get(file)!;
        if (offset >= body.length) return status(id, 1);
        const chunk = body.subarray(offset, offset + length);
        audit.bytesRead += chunk.length;
        channel.data(id, chunk);
      }),
    );
  }

  // 与现有真实握手测试一致，ECDSA 避开 ssh2 的 Ed25519 生成边界。
  const key = ssh2.utils.generateKeyPairSync('ecdsa', { bits: 256 });
  const server = new ssh2.Server({ hostKeys: [key.private] }, (client) => {
    audit.connections++;
    peers.add(client);
    client.on('error', () => undefined);
    client.once('close', () => peers.delete(client));
    client.on('authentication', (context) => {
      if (context.method === 'password' && context.password === PASSWORD) {
        audit.authentications++;
        context.accept();
      } else context.reject(['password']);
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (open) => dispatch('SFTP', () => attachSftp(open())));
        session.on('exec', (open) => {
          audit.commands++;
          const channel = open();
          channel.exit(0);
          channel.end();
        });
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SFTP fixture 未监听 TCP');
  const identity = { hostname: '127.0.0.1', port: address.port, username: 'demo' };
  const localHome = path.join(os.tmpdir(), `remote-sftp-fixture-${address.port}`);
  const configFile = path.join(localHome, '.ssh', 'config');
  const knownFile = path.join(localHome, '.ssh', 'known_hosts');
  let knownHosts = `[${identity.hostname}]:${identity.port} ${key.public}\n`;
  const pool = createSshPool({
    homeDir: localHome,
    lookupHost: async (alias) =>
      alias === 'my-server'
        ? {
            alias,
            hostname: identity.hostname,
            port: identity.port,
            user: identity.username,
            authMode: 'password',
            identityFiles: [],
            unsupported: [],
          }
        : undefined,
    readFile: async (file) => {
      if (file === configFile)
        return Buffer.from(
          `Host my-server\n HostName ${identity.hostname}\n Port ${identity.port}\n User ${identity.username}\n`,
        );
      if (file === knownFile) return Buffer.from(knownHosts);
      throw new Error('ENOENT');
    },
  });
  await pool.setPassword('my-server', PASSWORD);
  const workspace: Workspace = {
    id: 'fixture-workspace',
    name: '合成工作区',
    sshHost: 'my-server',
    remoteDir: root,
    localDir: path.join(localHome, 'mirror'),
  };
  const target: RemoteBrowseTarget = {
    sshHost: workspace.sshHost,
    remoteDir: workspace.remoteDir,
    localDir: workspace.localDir,
  };
  return {
    port: address.port,
    pool,
    workspace,
    target,
    root,
    home,
    outside,
    denied,
    slow,
    audit,
    nodes,
    holdNext,
    privateDiagnostic: PRIVATE_DIAGNOSTIC,
    resources: () => ({ peers: peers.size, channels: channels.size, handles: handles.size }),
    changeIdentity: (next: Partial<typeof identity>) => Object.assign(identity, next),
    changeTrust: (text: string) => {
      knownHosts = text;
    },
    trust: () => knownHosts,
    authenticate: () => pool.setPassword(workspace.sshHost, PASSWORD),
    async close() {
      pool.dispose();
      for (const gate of held) {
        gate.action?.();
        gate.action = undefined;
      }
      held.clear();
      for (const peer of peers) peer.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export type RemoteSftpFixture = Awaited<ReturnType<typeof startRemoteSftpFixture>>;
