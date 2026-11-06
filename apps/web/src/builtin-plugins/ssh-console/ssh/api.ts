import type {
  SshAuthMode,
  SshHostInfo,
  HostTrustStatus,
  HostTrustConfirmation,
  ManualServerInput,
  ManagedServer,
} from '@agentdeck/shared/ssh';
import { request } from '../../../lib/http';

export type SshConnectionTarget = { sshHost: string; authMode: SshAuthMode };
export type SshConnectInput = { sshHost: string; password?: string; savePassword?: boolean };
export type SshCredentialStatus = {
  saved: boolean;
  savingAvailable: boolean;
  paused: boolean;
  connected: boolean;
  hasPassword: boolean;
};
export type SshConnectResult = { connected: true; authMode: SshAuthMode } & SshCredentialStatus;
export type SshPasswordRead = { password: string | null; revision: string; savingAvailable: boolean };
export type SshServerEditInput = {
  input: ManualServerInput;
  expected: ManagedServer;
  revision: string;
  password?: string | null;
};

export const sshApi = {
  listSshHosts: (signal?: AbortSignal) => request<ManagedServer[]>('/api/ssh-targets', { signal, cache: 'no-store' }),
  sshImportOptions: (signal?: AbortSignal) =>
    request<Array<SshHostInfo & { keyFile?: string }>>('/api/ssh-targets/import-options', { signal }),
  saveSshTarget: (input: ManualServerInput, signal?: AbortSignal) =>
    request<ManagedServer>('/api/ssh-targets', { method: 'POST', signal, body: JSON.stringify(input) }),
  updateSshTarget: (alias: string, input: ManualServerInput, expected: ManagedServer, signal?: AbortSignal) =>
    request<ManagedServer>(`/api/ssh-targets/${encodeURIComponent(alias)}`, {
      method: 'PUT',
      signal,
      body: JSON.stringify({ input, expected }),
    }),
  deleteSshTarget: (expected: ManagedServer, signal?: AbortSignal) =>
    request<void>(`/api/ssh-targets/${encodeURIComponent(expected.alias)}`, {
      method: 'DELETE',
      signal,
      body: JSON.stringify({ expected, confirmed: true }),
    }),
  /** 仅编辑器按需使用；响应正文不能交给查询缓存或浏览器持久存储。 */
  readSshPassword: (expected: ManagedServer, signal?: AbortSignal) =>
    request<SshPasswordRead>(`/api/ssh-targets/${encodeURIComponent(expected.alias)}/password/read`, {
      method: 'POST',
      signal,
      cache: 'no-store',
      body: JSON.stringify({ expected }),
    }),
  saveSshTargetEdit: (edit: SshServerEditInput, signal?: AbortSignal) =>
    request<ManagedServer>(`/api/ssh-targets/${encodeURIComponent(edit.expected.alias)}/password`, {
      method: 'PUT',
      signal,
      cache: 'no-store',
      body: JSON.stringify({
        input: edit.input,
        expected: edit.expected,
        revision: edit.revision,
        password: edit.password,
        confirmed: true,
      }),
    }),
  createSshTargetWithPassword: (input: ManualServerInput, password: string, signal?: AbortSignal) =>
    request<ManagedServer>('/api/ssh-targets/with-password', {
      method: 'POST',
      signal,
      cache: 'no-store',
      body: JSON.stringify({ input, password, confirmed: true }),
    }),
  probeHostKey: (sshHost: string, signal?: AbortSignal) =>
    request<HostTrustStatus>('/api/ssh/host-key', {
      method: 'POST',
      signal,
      cache: 'no-store',
      body: JSON.stringify({ sshHost }),
    }),
  confirmHostKey: (input: HostTrustConfirmation, signal?: AbortSignal) =>
    request<HostTrustStatus>('/api/ssh/host-key/confirm', {
      method: 'POST',
      signal,
      cache: 'no-store',
      body: JSON.stringify(input),
    }),
  /** 凭据只随这次请求发送，不经过 React Query 或浏览器持久存储。 */
  connectSsh: (input: SshConnectInput, signal?: AbortSignal) =>
    request<SshConnectResult>('/api/ssh/connect', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        sshHost: input.sshHost,
        password: input.password,
        savePassword: input.savePassword,
      }),
    }),
  sshCredentials: (sshHost: string, signal?: AbortSignal) =>
    request<SshCredentialStatus>(`/api/ssh/credentials?sshHost=${encodeURIComponent(sshHost)}`, {
      signal,
      cache: 'no-store',
    }),
  clearSavedSshPassword: (sshHost: string, signal?: AbortSignal) =>
    request<SshCredentialStatus>('/api/ssh/credentials', {
      method: 'PUT',
      signal,
      body: JSON.stringify({ sshHost, savePassword: false }),
    }),
  disconnectSsh: (sshHost: string, signal?: AbortSignal) =>
    request<void>('/api/ssh/disconnect', { method: 'POST', signal, body: JSON.stringify({ sshHost }) }),
};
export const sshKeys = {
  sshImportOptions: ['ssh-import-options'] as const,
  sshHosts: ['ssh-targets'] as const,
  sshCredentials: (sshHost: string) => ['ssh-credentials', sshHost] as const,
};
