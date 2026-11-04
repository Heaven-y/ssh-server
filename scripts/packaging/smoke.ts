import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { connectCdp, eventually } from './cdp';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const mode =
  process.argv[2] === '--portable' ? 'portable' : process.argv[2] === '--installed' ? 'installed' : 'unpacked';
const source = mode === 'unpacked' ? process.argv[2] : process.argv[3];
const packaged = path.resolve(source ?? path.join(repository, 'release/win-unpacked'));
const reportDirectory = path.join(repository, 'release/verification');
const reportName = `${mode}-smoke`;
const PageSchema = z.array(
  z.object({ type: z.string(), url: z.string(), webSocketDebuggerUrl: z.string().optional() }),
);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法保留调试端口');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}
function isolatedEnvironment(root: string): NodeJS.ProcessEnv {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) throw new Error('无法确定 Windows 系统目录');
  const profile = path.join(root, 'profile');
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    COMSPEC: path.join(systemRoot, 'System32/cmd.exe'),
    PATH: path.join(systemRoot, 'System32'),
    TEMP: path.join(root, 'temp'),
    TMP: path.join(root, 'temp'),
    USERPROFILE: profile,
    APPDATA: path.join(profile, 'AppData/Roaming'),
    LOCALAPPDATA: path.join(profile, 'AppData/Local'),
    CLAUDE_CONFIG_DIR: path.join(profile, '.claude'),
    CODEX_HOME: path.join(profile, '.codex'),
    AGENTDECK_CONFIG_DIR: path.join(root, 'configuration'),
  };
}
function launch(executable: string, args: string[], env: NodeJS.ProcessEnv, directory: string) {
  const process = spawn(executable, args, {
    cwd: directory,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  process.stdout?.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString('utf8')).slice(-65536);
  });
  process.stderr?.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString('utf8')).slice(-65536);
  });
  return { process, output: () => output };
}
function exited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

type RendererReport = {
  title: string;
  platform: string;
  nodeExposed: boolean;
  projects: unknown[];
  plugins: unknown[];
  htmlLoaded: boolean;
};
function assertRenderer(report: RendererReport) {
  if (
    !report.htmlLoaded ||
    report.platform !== 'win32' ||
    report.nodeExposed ||
    report.projects.length !== 0 ||
    report.plugins.length !== 1
  )
    throw new Error('桌面首屏、预加载或隔离数据验证失败');
}
async function stopProcesses(children: Array<ChildProcess | undefined>) {
  for (const child of children) {
    if (!child || exited(child)) continue;
    child.kill();
    await eventually(() => Promise.resolve(exited(child) ? true : undefined), '验收进程结束', 5000);
  }
}
async function cleanTemporary(root: string) {
  const verified = path.resolve(root);
  if (
    path.dirname(verified) !== path.resolve(os.tmpdir()) ||
    !path.basename(verified).startsWith('agentdeck-package-smoke-')
  )
    throw new Error('临时验收目录不符合清理范围');
  await rm(verified, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
}

async function prepareApplication(root: string): Promise<string> {
  if (mode === 'installed') return path.join(packaged, 'AgentDeck.exe');
  const target = path.join(root, mode === 'portable' ? 'AgentDeck-portable.exe' : 'application');
  await cp(packaged, target, { recursive: true, dereference: false });
  return mode === 'portable' ? target : path.join(target, 'AgentDeck.exe');
}

async function smoke(root: string) {
  const executable = await prepareApplication(root);
  const env = isolatedEnvironment(root);
  for (const directory of [env.USERPROFILE, env.APPDATA, env.LOCALAPPDATA, env.TEMP])
    await mkdir(directory!, { recursive: true });
  const port = await freePort();
  const profileArg = `--user-data-dir=${path.join(root, 'chromium')}`;
  const args = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--disable-gpu', profileArg];
  const first = launch(executable, args, env, root);
  let second: ReturnType<typeof launch> | undefined;
  let cdp: Awaited<ReturnType<typeof connectCdp>> | undefined;
  try {
    const page = await eventually(async () => {
      if (exited(first.process)) throw new Error('桌面进程提前退出');
      const result: unknown = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return PageSchema.parse(result).find(
        (item) => item.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(item.url),
      );
    }, '独立桌面页面');
    if (!page.webSocketDebuggerUrl) throw new Error('桌面页面缺少调试地址');
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await eventually(async () => {
      const ready = await cdp!.evaluate<boolean>('!!document.querySelector("#root")?.textContent?.includes("项目")');
      return ready ? true : undefined;
    }, '首屏完成');
    const report = await cdp.evaluate<RendererReport>(`(async () => {
      const projects = await fetch('/api/projects').then(response => response.json());
      const plugins = await fetch('/api/plugins').then(response => response.json());
      return { title: document.title, platform: window.agentDeck?.platform, nodeExposed: typeof window.require !== 'undefined', projects, plugins: plugins.plugins, htmlLoaded: !!document.querySelector('#root')?.textContent?.trim() };
    })()`);
    assertRenderer(report);
    const screenshot = await cdp.call<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(path.join(reportDirectory, `${reportName}.png`), Buffer.from(screenshot.data, 'base64'));
    second = launch(executable, [profileArg], env, root);
    await eventually(
      () => Promise.resolve(exited(second!.process) ? true : undefined),
      '第二实例退出',
      mode === 'portable' ? 45000 : 15000,
    );
    if (exited(first.process)) throw new Error('第二实例意外关闭主实例');
    await cdp.evaluate('setTimeout(() => window.close(), 0); true');
    await eventually(() => Promise.resolve(exited(first.process) ? true : undefined), '桌面正常退出', 15000);
    await eventually(async () => {
      try {
        await fetch(page.url);
        return undefined;
      } catch {
        return true;
      }
    }, '本机后端端口关闭');
    const result = { mode, ...report, singleInstance: true, cleanExit: true, isolatedFromRepository: true };
    await writeFile(path.join(reportDirectory, `${reportName}.json`), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } catch (error) {
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(path.join(reportDirectory, `${reportName}-error.log`), first.output());
    throw error;
  } finally {
    cdp?.close();
    await stopProcesses([first.process, second?.process]);
  }
}

if (process.platform !== 'win32') throw new Error('本地安装包验收脚本仅用于 Windows');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-package-smoke-'));
try {
  await smoke(temporary);
} finally {
  await cleanTemporary(temporary);
}
