import { request } from '../../../lib/http';
import type {
  SshConsoleDirectory,
  SshConsoleOverview,
  SshConsolePreview,
  SshConsoleProcesses,
  SshConsoleTerminal,
  SshConsoleTerminalCreate,
  SshConsoleTerminalRead,
} from '@agentdeck/shared/ssh';

const base = (serverId: string) => `/api/ssh-console/${encodeURIComponent(serverId)}`;
const terminal = (serverId: string, id: string) => `${base(serverId)}/terminals/${encodeURIComponent(id)}`;
const get = <T>(url: string, signal?: AbortSignal) => request<T>(url, { signal, cache: 'no-store' });
const post = <T>(url: string, body: unknown, signal?: AbortSignal) =>
  request<T>(url, { method: 'POST', body: JSON.stringify(body), signal, cache: 'no-store' });

export const sshConsoleApi = {
  overview: (serverId: string, path: string, signal?: AbortSignal) =>
    get<SshConsoleOverview>(`${base(serverId)}/overview?${new URLSearchParams({ path })}`, signal),
  processes: (serverId: string, signal?: AbortSignal) =>
    get<SshConsoleProcesses>(`${base(serverId)}/processes`, signal),
  directory: (serverId: string, path: string, signal?: AbortSignal) =>
    get<SshConsoleDirectory>(`${base(serverId)}/files?${new URLSearchParams({ path })}`, signal),
  preview: (serverId: string, path: string, signal?: AbortSignal) =>
    get<SshConsolePreview>(`${base(serverId)}/preview?${new URLSearchParams({ path })}`, signal),
  terminals: (serverId: string, signal?: AbortSignal) =>
    get<{ terminals: SshConsoleTerminal[] }>(`${base(serverId)}/terminals`, signal),
  createTerminal: (serverId: string, input: SshConsoleTerminalCreate) =>
    post<SshConsoleTerminal>(`${base(serverId)}/terminals`, input),
  readTerminal: (serverId: string, id: string, fromSeq: number, signal?: AbortSignal) =>
    get<SshConsoleTerminalRead>(
      `${terminal(serverId, id)}?${new URLSearchParams({ fromSeq: String(fromSeq) })}`,
      signal,
    ),
  inputTerminal: (serverId: string, id: string, data: string) =>
    post<{ written: number }>(`${terminal(serverId, id)}/input`, { data }),
  resizeTerminal: (serverId: string, id: string, size: { cols: number; rows: number }) =>
    post<SshConsoleTerminal>(`${terminal(serverId, id)}/resize`, size),
  closeTerminal: (serverId: string, id: string) =>
    request<void>(terminal(serverId, id), { method: 'DELETE', cache: 'no-store' }),
};
