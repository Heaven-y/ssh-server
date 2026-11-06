import { afterEach, expect, it, vi } from 'vitest';
import { sshApi } from '../../../../src/builtin-plugins/ssh-console/ssh/api';
import { respond } from '../../../fixtures/http';
afterEach(() => vi.unstubAllGlobals());
it('密码和保存偏好仅发送到认证接口，取消保存只发送目标', async () => {
  respond(200, { connected: true, authMode: 'password', saved: true, savingAvailable: true, paused: false });
  await sshApi.connectSsh({
    sshHost: 'my-server',
    password: 'fixture-secret',
    savePassword: true,
  });
  expect(vi.mocked(fetch).mock.calls[0]).toEqual([
    '/api/ssh/connect',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        sshHost: 'my-server',
        password: 'fixture-secret',
        savePassword: true,
      }),
    }),
  ]);
  await sshApi.clearSavedSshPassword('my-server');
  expect(vi.mocked(fetch).mock.calls[1]).toEqual([
    '/api/ssh/credentials',
    expect.objectContaining({ method: 'PUT', body: '{"sshHost":"my-server","savePassword":false}' }),
  ]);
  await sshApi.sshCredentials('my/server');
  expect(vi.mocked(fetch).mock.calls[2]).toEqual([
    '/api/ssh/credentials?sshHost=my%2Fserver',
    expect.objectContaining({ cache: 'no-store' }),
  ]);
});
