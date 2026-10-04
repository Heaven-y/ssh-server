// 真实 ssh2 握手和通道的本机验收夹具；不读取用户的 SSH 配置或密钥。
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ssh2, { type Connection, type ServerChannel, type Session, type SFTPWrapper } from 'ssh2';
import { createSshPool } from '../../apps/server/src/ssh/pool';
import { createWorkspaceStore } from '../../apps/server/src/workspaces/store';

const HOME = '/home/demo';
const ROOT = `${HOME}/projects/demo`;
const DIR = { mode: 0o40755, size: 0, uid: 1000, gid: 1000, atime: 0, mtime: 0 };
export type FixtureShell = {
  id: number;
  closed: boolean;
  inputs: string[];
  sizes: Array<{ cols: number; rows: number }>;
};

function serveSftp(sftp: SFTPWrapper) {
  sftp.on('error', () => undefined);
  sftp.on('REALPATH', (id: number, requested: string) => {
    const filename = requested === '.' ? HOME : requested;
    if (filename !== HOME && filename !== ROOT) sftp.status(id, 2);
    else sftp.name(id, [{ filename, longname: filename, attrs: DIR }]);
  });
  const stat = (id: number, requested: string) => {
    if (requested === ROOT || requested === HOME) sftp.attrs(id, DIR);
    else sftp.status(id, 2);
  };
  sftp.on('LSTAT', stat);
  sftp.on('STAT', stat);
}

function command(channel: ServerChannel, text: string, id: number) {
  if (text === 'exit') {
    channel.write(`通道${id}最终输出\r\n`);
    channel.exit(7);
    channel.end();
    return;
  }
  if (text === 'fixture-screen') channel.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[32m备用屏幕\x1b[0m\x1b[?1000h');
  else if (text === 'fixture-normal') channel.write('\x1b[?1000l\x1b[?1049l');
  else if (text === 'fixture-bracket') channel.write('\x1b[?2004h');
  else if (text === 'fixture-osc52') channel.write('\x1b]52;c;cmVtb3RlLXNlY3JldA==\x07');
  else if (text === 'fixture-burst') channel.write(Buffer.alloc(512 * 1024, 120));
  else if (text === 'pwd') channel.write(`${ROOT}\r\n`);
  else channel.write(`通道${id}收到：${text}\r\n`);
  channel.write(`demo:${id}$ `);
}

function serveShell(channel: ServerChannel, shell: FixtureShell) {
  let initialized = false;
  let buffered = '';
  channel.on('error', () => undefined);
  channel.once('close', () => {
    shell.closed = true;
  });
  channel.setEncoding('utf8');
  channel.on('data', (text: string) => {
    if (!initialized) {
      const token = text.match(/([a-f0-9]{32}):ok/);
      if (!token) return;
      // 先回显文字转义，随后发送真正的确认字节，不能靠回显通过初始化。
      channel.write(text);
      channel.write(`\x1e${token[1]}:ok\x1f欢迎进入中文终端\r\ndemo:${shell.id}$ `);
      initialized = true;
      return;
    }
    shell.inputs.push(text);
    if (text.includes('\x03')) {
      buffered = '';
      channel.write(`^C\r\ndemo:${shell.id}$ `);
      return;
    }
    buffered += text.replaceAll('\x1b[200~', '').replaceAll('\x1b[201~', '').replaceAll('\r', '\n');
    const lines = buffered.split('\n');
    buffered = lines.pop()!;
    for (const line of lines) command(channel, line, shell.id);
  });
}

function serveSession(session: Session, shells: FixtureShell[]) {
  let shell: FixtureShell | undefined;
  session.on('pty', (accept, _reject, info) => {
    shell = { id: shells.length + 1, closed: false, inputs: [], sizes: [{ cols: info.cols, rows: info.rows }] };
    shells.push(shell);
    accept();
  });
  session.on('window-change', (accept, _reject, info) => {
    shell?.sizes.push({ cols: info.cols, rows: info.rows });
    accept?.();
  });
  session.on('shell', (accept, reject) => {
    if (!shell) {
      reject();
      return;
    }
    serveShell(accept(), shell);
  });
  session.on('sftp', (accept) => serveSftp(accept()));
  session.on('exec', (accept) => {
    const channel = accept();
    channel.exit(0);
    channel.end(`${ROOT}\n`);
  });
}

export async function startTerminalFixture({ configDir, workspaceDir }: { configDir: string; workspaceDir: string }) {
  await mkdir(workspaceDir, { recursive: true });
  const key = ssh2.utils.generateKeyPairSync('ecdsa', { bits: 256 });
  const peers = new Set<Connection>();
  const shells: FixtureShell[] = [];
  const server = new ssh2.Server({ hostKeys: [key.private] }, (client) => {
    peers.add(client);
    client.on('error', () => undefined);
    client.once('close', () => peers.delete(client));
    client.on('authentication', (context) => {
      if (context.method === 'password' && context.username === 'demo' && context.password === 'fixture-only')
        context.accept();
      else context.reject(['password']);
    });
    client.on('ready', () => client.on('session', (accept) => serveSession(accept(), shells)));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('夹具未监听TCP');
  const sshDir = path.join(configDir, '.ssh');
  const files = new Map<string, Buffer>([
    [
      path.join(sshDir, 'config'),
      Buffer.from(`Host my-server\n HostName 127.0.0.1\n Port ${address.port}\n User demo\n`),
    ],
    [path.join(sshDir, 'known_hosts'), Buffer.from(`[127.0.0.1]:${address.port} ${key.public}\n`)],
  ]);
  const pool = createSshPool({
    homeDir: configDir,
    readFile: (file) => {
      const value = files.get(file);
      if (!value) return Promise.reject(new Error('ENOENT'));
      return Promise.resolve(value);
    },
  });
  await pool.setPassword('my-server', 'fixture-only');
  const store = createWorkspaceStore({
    configDir,
    knownHosts: () => Promise.resolve(['my-server']),
    dirExists: (dir) => Promise.resolve(dir === path.resolve(workspaceDir)),
  });
  const workspace = await store.create({
    name: '终端验收',
    localDir: path.resolve(workspaceDir),
    sshHost: 'my-server',
    authMode: 'password',
    remoteDir: ROOT,
  });
  return {
    pool,
    store,
    workspace,
    shells,
    async close() {
      pool.dispose();
      for (const peer of peers) peer.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
