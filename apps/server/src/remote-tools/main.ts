// remote-tools MCP 子进程入口：由 Claude Code / Codex 按会话启动，通过 stdio 通信。
// 注意：stdout 是 MCP 协议通道，不能打印日志。
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRemoteToolsServer } from './tools';

const internalUrl = process.env.SSH_SERVER_INTERNAL_URL;
const token = process.env.SSH_SERVER_SESSION_TOKEN;
if (!internalUrl || !token) {
  console.error('缺少环境变量 SSH_SERVER_INTERNAL_URL 或 SSH_SERVER_SESSION_TOKEN');
  process.exit(2);
}

const server = createRemoteToolsServer({ internalUrl, token });
await server.connect(new StdioServerTransport());
