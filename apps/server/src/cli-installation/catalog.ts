import type { AgentKind } from '@agentdeck/shared/conversation';
import type { CliInstallation, CliRelease } from './types';
import { BackendError, objectValue, VERSION, type BackendContext } from './backend-support';

// 官方依据：Claude setup、OpenAI codex README、Antigravity 官方 install.ps1。
export const INSTALLERS: Record<AgentKind, string> = {
  claude: 'https://claude.ai/install.ps1',
  codex: 'https://chatgpt.com/codex/install.ps1',
  antigravity: 'https://antigravity.google/cli/install.ps1',
};
const NPM_RELEASES = {
  claude: 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest',
  codex: 'https://registry.npmjs.org/@openai/codex/latest',
};
const CLAUDE_RELEASES = {
  latest: 'https://downloads.claude.ai/claude-code-releases/latest',
  stable: 'https://downloads.claude.ai/claude-code-releases/stable',
};
const CODEX_RELEASE = 'https://releases.openai.com/codex/channels/latest';
// 2026-11 已只读核实官方入口的固定 302；其他跳转一律停止。
const INSTALLER_REDIRECTS: Record<string, string> = {
  'https://claude.ai/install.ps1': 'https://downloads.claude.ai/claude-code-releases/bootstrap.ps1',
  'https://chatgpt.com/codex/install.ps1': 'https://releases.openai.com/codex/install.ps1',
};
const AGY_RELEASES = {
  x64: 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/windows_amd64.json',
  arm64: 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/windows_arm64.json',
};

async function boundedBody(response: Response, cap: number): Promise<string> {
  const advertised = Number(response.headers.get('content-length'));
  if (advertised > cap) throw new BackendError('response_limit', '官方响应过大，已停止读取。');
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (!reader) throw new BackendError('response_invalid', '官方响应为空，请稍后重试。');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > cap) throw new BackendError('response_limit', '官方响应超过大小上限，已停止读取。');
      chunks.push(part.value);
    }
    return Buffer.concat(chunks)
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trim();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function officialResponse(context: BackendContext, url: string, signal: AbortSignal): Promise<Response> {
  const init: RequestInit = { signal, redirect: 'manual', headers: { Accept: 'application/json, text/plain, */*' } };
  const response = await context.fetch(url, init);
  if (![301, 302, 303, 307, 308].includes(response.status)) return response;
  const target = INSTALLER_REDIRECTS[url];
  if (!target || response.headers.get('location') !== target)
    throw new BackendError('redirect_rejected', '官方服务返回了无法验证的跳转，已停止下载。');
  await response.body?.cancel();
  return context.fetch(target, init);
}

// URL 仅来自本模块固定官方目录；安装器只允许已核实的单次固定跳转。
export async function officialText(
  context: BackendContext,
  url: string,
  options: { signal?: AbortSignal; cap?: number } = {},
): Promise<string> {
  const timeout = AbortSignal.timeout(20_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await officialResponse(context, url, signal);
    if (!response.ok)
      throw new BackendError('download_failed', `官方服务返回 HTTP ${response.status}，请稍后重试或按官方指引安装。`);
    return await boundedBody(response, options.cap ?? 256 * 1024);
  } catch (error) {
    if (error instanceof BackendError) throw error;
    if (options.signal?.aborted) throw new BackendError('aborted', 'CLI 操作已取消。');
    if (timeout.aborted) throw new BackendError('network_timeout', '连接官方服务超时，请检查网络后重试。');
    throw new BackendError('network_failed', '无法连接官方服务，请检查网络后重试。');
  }
}

function release(version: unknown): CliRelease {
  if (typeof version !== 'string' || version.length > 100 || !VERSION.test(version))
    throw new BackendError('release_invalid', '官方版本数据格式无法识别，请稍后重试。');
  return { version };
}
function jsonObject(text: string): Record<string, unknown> {
  try {
    const value = objectValue(JSON.parse(text));
    if (value) return value;
  } catch {
    /* 不把远端原文带进错误。 */
  }
  throw new BackendError('release_invalid', '官方版本数据格式无法识别，请稍后重试。');
}

async function agyRelease(context: BackendContext, signal?: AbortSignal): Promise<CliRelease> {
  if (context.platform !== 'win32' || (context.arch !== 'x64' && context.arch !== 'arm64'))
    throw new BackendError('unsupported_platform', '当前平台的 Antigravity 版本查询暂未适配，请查看官方指引。');
  const data = jsonObject(await officialText(context, AGY_RELEASES[context.arch], { signal }));
  if (
    typeof data.url !== 'string' ||
    !/^https:\/\/storage\.googleapis\.com\/antigravity-public\/antigravity-cli\/[a-zA-Z0-9._-]+\/windows-(x64|arm64)\/cli_windows_(x64|arm64)\.exe$/.test(
      data.url,
    ) ||
    !data.url.endsWith(`/windows-${context.arch}/cli_windows_${context.arch}.exe`) ||
    typeof data.sha512 !== 'string' ||
    !/^[a-fA-F0-9]{128}$/.test(data.sha512)
  )
    throw new BackendError('release_invalid', '官方发布清单无法验证，请稍后重试。');
  return release(data.version);
}

export async function latestRelease(
  context: BackendContext,
  installation: CliInstallation,
  signal?: AbortSignal,
): Promise<CliRelease> {
  if (installation.agent === 'antigravity') return agyRelease(context, signal);
  if (installation.agent === 'codex' && !installation.npm) {
    const tag = jsonObject(await officialText(context, CODEX_RELEASE, { signal })).tag_name;
    return release(typeof tag === 'string' ? tag.replace(/^rust-v/, '') : tag);
  }
  if (
    installation.agent === 'claude' &&
    (installation.source === 'native' || installation.channel === 'stable' || !installation.npm)
  ) {
    return release(await officialText(context, CLAUDE_RELEASES[installation.channel ?? 'latest'], { signal }));
  }
  return release(jsonObject(await officialText(context, NPM_RELEASES[installation.agent], { signal })).version);
}
