import path from 'node:path';

export function desktopPaths(input: { packaged: boolean; resourcesPath: string; mainDirectory: string }) {
  return {
    web: input.packaged ? path.join(input.resourcesPath, 'web') : path.join(input.mainDirectory, '../../../web/dist'),
    preload: path.join(input.mainDirectory, '../preload/preload.cjs'),
  };
}
export function rendererAddress(packaged: boolean, raw?: string): string | undefined {
  const address = raw?.trim();
  if (packaged || !address) return undefined;
  const url = new URL(address);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('开发页面必须使用本机 HTTP 地址');
  return url.href;
}
export function externalWebLink(address: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(address).protocol);
  } catch {
    return false;
  }
}
export function navigationAllowed(initial: string, target: string): boolean {
  try {
    return externalWebLink(target) && new URL(initial).origin === new URL(target).origin;
  } catch {
    return false;
  }
}
