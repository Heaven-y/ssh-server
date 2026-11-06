import http from 'node:http';
import { SessionError } from '../../chat/sessions';

export type ManagementRecord = Record<string, unknown>;
export type ManagementMethod =
  | 'GetCascadeTrajectory'
  | 'GetCascadeTrajectorySteps'
  | 'GetConversationMetadata'
  | 'ForkConversation'
  | 'DeleteCascadeTrajectory'
  | 'JetboxDeleteSummary'
  | 'UpdateConversationAnnotations';
export type ManagementBackend = {
  request(method: ManagementMethod, params: ManagementRecord): Promise<ManagementRecord>;
  close(): Promise<void>;
};
export const managementObject = (value: unknown): ManagementRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as ManagementRecord) : {};
export const managementText = (value: unknown) => (typeof value === 'string' ? value : '');
export const managementFailure = () =>
  new SessionError(503, 'session_runtime_failed', 'Antigravity 原生管理请求失败，请核对 CLI 版本与本机配置。');
export class NativeTrajectoryMissing extends SessionError {
  constructor() {
    super(404, 'session_missing', 'Antigravity 原生会话不存在。');
  }
}

function trajectoryMissing(method: ManagementMethod, body: Buffer): boolean {
  if (method !== 'GetCascadeTrajectory') return false;
  try {
    return managementObject(JSON.parse(body.toString('utf8'))).code === 'not_found';
  } catch {
    return false;
  }
}

/** 只连接当前管理子进程报告的回环端口；不跟随重定向，也不回传原始诊断。 */
export function managementRequest(
  port: number,
  method: ManagementMethod,
  params: ManagementRecord,
  signal?: AbortSignal,
): Promise<ManagementRecord> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(params));
    const request = http.request({
      hostname: '127.0.0.1',
      signal,
      port,
      method: 'POST',
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      headers: { 'content-type': 'application/json', 'content-length': body.length },
    });
    const timer = setTimeout(() => request.destroy(managementFailure()), 15_000);
    const finish = (error?: Error, value?: ManagementRecord) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    request.once('error', () => finish(managementFailure()));
    request.once('response', (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024) response.destroy(managementFailure());
        else chunks.push(chunk);
      });
      response.once('error', () => finish(managementFailure()));
      response.once('end', () => {
        const code = response.statusCode ?? 500;
        const body = Buffer.concat(chunks);
        if (code === 404) {
          finish(trajectoryMissing(method, body) ? new NativeTrajectoryMissing() : managementFailure());
          return;
        }
        if (code < 200 || code >= 300) {
          finish(managementFailure());
          return;
        }
        try {
          const value: unknown = JSON.parse(body.toString('utf8'));
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          finish(undefined, value as ManagementRecord);
        } catch {
          finish(managementFailure());
        }
      });
    });
    request.end(body);
  });
}
