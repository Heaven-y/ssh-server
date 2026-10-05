import { randomUUID } from 'node:crypto';
import type { AgentTurnInput, PermissionAnswer } from '../types';
import type { CodexClient } from './client';
import type { CodexEventMapper } from './mapper';
import { record, text, type RecordValue, type RpcId, type ServerRequest } from './types';
import { MCP_SERVER_NAME } from '../../remote-tools/launch';

export const CODEX_PERMISSION_TIMEOUT_MS = 300_000;
const METHODS = new Map([
  ['item/commandExecution/requestApproval', 'commandExecution'],
  ['item/fileChange/requestApproval', 'fileChange'],
  ['item/permissions/requestApproval', 'permissions'],
]);
type Decision = 'allowed' | 'denied' | 'cancelled';
type PendingApproval = { request: ServerRequest; appId: string; timer: NodeJS.Timeout };

/** 0.160.0 将 MCP 工具确认作为空表单请求；普通表单和 URL 交互仍不支持。 */
function emptyObjectSchema(schema: RecordValue): boolean {
  const properties = schema.properties;
  return (
    schema.type === 'object' &&
    !!properties &&
    typeof properties === 'object' &&
    !Array.isArray(properties) &&
    Object.keys(properties).length === 0 &&
    (schema.required === undefined || (Array.isArray(schema.required) && schema.required.length === 0)) &&
    (schema.additionalProperties === undefined || schema.additionalProperties === false)
  );
}
function mcpToolApproval(request: ServerRequest): boolean {
  const params = request.params;
  return (
    request.method === 'mcpServer/elicitation/request' &&
    params.serverName === MCP_SERVER_NAME &&
    params.mode === 'form' &&
    record(params._meta).codex_approval_kind === 'mcp_tool_call' &&
    emptyObjectSchema(record(params.requestedSchema))
  );
}

function grantedPermissions(params: RecordValue): RecordValue {
  const requested = record(params.permissions);
  const permissions: RecordValue = {};
  for (const key of ['network', 'fileSystem']) {
    if (requested[key] && typeof requested[key] === 'object') permissions[key] = requested[key];
  }
  return permissions;
}
function responseFor(request: ServerRequest, decision: Decision): RecordValue {
  if (request.method === 'mcpServer/elicitation/request') {
    return {
      action: { allowed: 'accept', denied: 'decline', cancelled: 'cancel' }[decision],
      ...(decision === 'allowed' ? { content: {} } : {}),
    };
  }
  if (request.method === 'item/permissions/requestApproval') {
    return { permissions: decision === 'allowed' ? grantedPermissions(request.params) : {}, scope: 'turn' };
  }
  const decisions = { allowed: 'accept', denied: 'decline', cancelled: 'cancel' };
  return { decision: decisions[decision] };
}

/** 网页 UUID 与原生 RPC id 分离；结束后所有迟到答复都失效。 */
export class CodexPermissions {
  private readonly pending = new Map<RpcId, PendingApproval>();
  private stopped = false;
  constructor(
    private readonly client: CodexClient,
    private readonly input: AgentTurnInput,
    private readonly mapper: CodexEventMapper,
  ) {}

  request(request: ServerRequest): void {
    const toolName = mcpToolApproval(request) ? `mcp__${MCP_SERVER_NAME}` : METHODS.get(request.method);
    if (!toolName) {
      this.client.rejectRequest(request.id);
      this.input.emit({ type: 'error', message: 'Codex 请求了暂不支持的交互操作，已拒绝。' });
      return;
    }
    if (this.stopped || this.pending.size >= 128) {
      this.client.respond(request.id, responseFor(request, 'cancelled'));
      return;
    }
    const appId = randomUUID();
    const toolInput = this.toolInput(toolName, request.params);
    const timer = setTimeout(() => this.finish(request.id, 'denied'), CODEX_PERMISSION_TIMEOUT_MS);
    this.pending.set(request.id, { request, appId, timer });
    this.input.emit({
      type: 'permission_request',
      requestId: appId,
      toolName,
      input: toolInput,
      description: text(request.params.reason) || text(request.params.message),
    });
    void this.answer(request.id, appId, toolName, toolInput);
  }

  private toolInput(toolName: string, params: RecordValue): RecordValue {
    if (toolName === `mcp__${MCP_SERVER_NAME}`) {
      const meta = record(params._meta);
      return { server: params.serverName, arguments: meta.tool_params, description: meta.tool_description };
    }
    if (toolName === 'commandExecution') return { command: params.command, cwd: params.cwd, reason: params.reason };
    if (toolName === 'permissions') return { permissions: params.permissions, cwd: params.cwd, reason: params.reason };
    return {
      changes: this.mapper.item(text(params.itemId)).changes,
      grantRoot: params.grantRoot,
      reason: params.reason,
    };
  }

  private async answer(rpcId: RpcId, requestId: string, toolName: string, input: unknown): Promise<void> {
    let answer: PermissionAnswer;
    try {
      answer = await this.input.requestPermission({ requestId, toolName, input });
    } catch {
      answer = { allow: false };
    }
    this.finish(rpcId, answer.allow ? 'allowed' : 'denied');
  }

  private finish(id: RpcId, decision: Decision, respond = true): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (respond) this.client.respond(id, responseFor(pending.request, decision));
    this.input.emit({ type: 'permission_resolved', requestId: pending.appId, decision });
  }

  resolved(id: unknown): void {
    if (typeof id === 'string' || typeof id === 'number') this.finish(id, 'cancelled', false);
  }
  cancel(): void {
    this.stopped = true;
    for (const id of this.pending.keys()) this.finish(id, 'cancelled');
  }
}
