import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { desktopPaths, externalWebLink, navigationAllowed, rendererAddress } from '../src/paths';

describe('桌面安装路径与导航', () => {
  it('安装版从自身resources读取页面，开发版沿用工作区产物路径', () => {
    const root = path.join(os.tmpdir(), 'desktop-path-fixture');
    const mainDirectory = path.join(root, 'application', 'out', 'main');
    const resourcesPath = path.join(root, 'resources');
    expect(desktopPaths({ packaged: true, resourcesPath, mainDirectory })).toEqual({
      web: path.join(resourcesPath, 'web'),
      preload: path.join(mainDirectory, '../preload/preload.cjs'),
    });
    expect(desktopPaths({ packaged: false, resourcesPath, mainDirectory }).web).toBe(
      path.join(mainDirectory, '../../../web/dist'),
    );
  });

  it('安装版忽略开发地址；开发地址只接受本机HTTP来源', () => {
    expect(rendererAddress(true, 'https://example.invalid')).toBeUndefined();
    expect(rendererAddress(false, ' http://127.0.0.1:5173/ ')).toBe('http://127.0.0.1:5173/');
    expect(rendererAddress(false, undefined)).toBeUndefined();
    for (const address of [
      'https://example.invalid',
      'file:///index.html',
      'javascript:alert(1)',
      'http://user@localhost/',
    ])
      expect(() => rendererAddress(false, address)).toThrow();
  });

  it('窗口只在自身来源内导航，系统外链仅允许HTTP和HTTPS', () => {
    expect(navigationAllowed('http://127.0.0.1:4317/', 'http://127.0.0.1:4317/settings')).toBe(true);
    expect(navigationAllowed('http://127.0.0.1:4317/', 'http://127.0.0.1:4318/')).toBe(false);
    for (const address of ['file:///tool.exe', 'javascript:alert(1)', 'custom-app:launch', 'data:text/html,hello']) {
      expect(externalWebLink(address)).toBe(false);
      expect(navigationAllowed('http://127.0.0.1:4317/', address)).toBe(false);
    }
    expect(externalWebLink('https://example.invalid/docs')).toBe(true);
  });
});
