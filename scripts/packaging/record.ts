import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile, listPackage } from '@electron/asar';

const root = fileURLToPath(new URL('../../', import.meta.url));
const release = path.join(root, 'release');
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const hashFile = async (file: string) => digest(await readFile(file));
const sourceFolders = [
  'apps/desktop/src/',
  'apps/desktop/assets/',
  'apps/server/src/',
  'apps/web/src/',
  'packages/shared/src/',
  'scripts/packaging/',
];
const sourceFiles = new Set([
  'package.json',
  'package-lock.json',
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  'apps/desktop/electron.vite.config.ts',
  'apps/desktop/electron-builder.yml',
]);
const packageFiles = /^((?:apps|packages)\/[^/]+\/package\.json)$/;

async function sourceFingerprint() {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  const selected = [...new Set(files.split('\0').filter(Boolean))]
    .filter(
      (file) =>
        sourceFolders.some((folder) => file.startsWith(folder)) || sourceFiles.has(file) || packageFiles.test(file),
    )
    .sort();
  const entries: Array<{ path: string; sha256: string }> = [];
  for (const file of selected) entries.push({ path: file, sha256: await hashFile(path.join(root, file)) });
  return { sha256: digest(entries.map((entry) => `${entry.path}\0${entry.sha256}`).join('\n')), files: entries };
}

async function verifyRuntime() {
  const archive = path.join(release, 'win-unpacked/resources/app.asar');
  const mainHash = digest(extractFile(archive, path.join('out', 'main', 'main.js')));
  const helperHash = digest(extractFile(archive, path.join('out', 'main', 'remote-helper.py')));
  const preloadHash = digest(extractFile(archive, path.join('out', 'preload', 'preload.cjs')));
  if (
    mainHash !== (await hashFile(path.join(root, 'apps/desktop/out/main/main.js'))) ||
    helperHash !== (await hashFile(path.join(root, 'apps/server/src/remote-files/remote-helper.py'))) ||
    preloadHash !== (await hashFile(path.join(root, 'apps/desktop/out/preload/preload.cjs')))
  )
    throw new Error('打包的主进程、preload 或远端 helper 与当前构建不一致');
  const entries = listPackage(archive, { isPack: false });
  if (entries.some((file) => /claude-agent-sdk-(win32|linux|darwin)|cpu-features|sshcrypto\.node/.test(file)))
    throw new Error('安装包包含不应分发的 CLI 或可选原生绑定');
  const webIndex = await hashFile(path.join(root, 'apps/web/dist/index.html'));
  if (webIndex !== (await hashFile(path.join(release, 'win-unpacked/resources/web/index.html'))))
    throw new Error('安装包页面不是当前前端构建');
  return { main: mainHash, preload: preloadHash, remoteHelper: helperHash, webIndex, archive: await hashFile(archive) };
}

const source = await sourceFingerprint();
const runtime = await verifyRuntime();
const artifacts = [];
for (const name of (await readdir(release))
  .filter((file) => /^AgentDeck-.+-(setup|portable)\.exe$/.test(file))
  .sort()) {
  const file = path.join(release, name);
  artifacts.push({ file: name, bytes: (await stat(file)).size, sha256: await hashFile(file) });
}
if (artifacts.length !== 2) throw new Error('缺少安装版或便携版产物');
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const record = { recordedAt: new Date().toISOString(), gitCommit, source, runtime, artifacts };
await writeFile(path.join(release, 'verification/build-record.json'), JSON.stringify(record, null, 2) + '\n');
await writeFile(
  path.join(release, 'SHA256SUMS.txt'),
  artifacts.map((artifact) => `${artifact.sha256}  ${artifact.file}\n`).join(''),
);
console.log(JSON.stringify({ gitCommit, sourceFingerprint: source.sha256, runtime, artifacts }));
