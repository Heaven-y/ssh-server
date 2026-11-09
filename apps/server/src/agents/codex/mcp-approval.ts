import { record, text, type RecordValue, type ServerRequest } from './types';

const EMPTY_FORM_FIELDS = new Set(['type', 'properties', 'required', 'title', 'description', '$schema']);

function hasNoInputFields(value: unknown): boolean {
  const schema = record(value);
  if (Object.keys(schema).some((key) => !EMPTY_FORM_FIELDS.has(key))) return false;
  const properties = schema.properties;
  const required = schema.required;
  return (
    schema.type === 'object' &&
    properties !== null &&
    typeof properties === 'object' &&
    !Array.isArray(properties) &&
    Object.keys(properties).length === 0 &&
    (required === undefined || (Array.isArray(required) && required.length === 0))
  );
}

/** 原生工具确认只需要同意或拒绝；资料表单和登录 URL 不能用空表单代答。 */
export function isMcpToolApproval(request: ServerRequest): boolean {
  const params = request.params;
  return (
    request.method === 'mcpServer/elicitation/request' &&
    params.mode === 'form' &&
    !!text(params.serverName).trim() &&
    record(params._meta).codex_approval_kind === 'mcp_tool_call' &&
    hasNoInputFields(params.requestedSchema)
  );
}

export function mcpApprovalInput(params: RecordValue): RecordValue {
  const meta = record(params._meta);
  return {
    server: text(params.serverName),
    ...(text(meta.tool_description) ? { description: text(meta.tool_description) } : {}),
    arguments: record(meta.tool_params),
  };
}
