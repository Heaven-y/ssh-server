import http from 'node:http';
import fs from 'node:fs';
import readline from 'node:readline';
import type { AddressInfo } from 'node:net';

const args = process.argv.slice(2);
const log = args[args.indexOf('--log-file') + 1]!;
const mode = process.env.AGY_FIXTURE_MODE;
const evidence = process.env.AGY_FIXTURE_EVIDENCE!;
const server = http.createServer((request, response) => {
  if (mode === 'rpc-hang') return;
  request.resume();
  request.on('end', () => {
    if (mode === 'rpc-missing' || mode === 'rpc-unknown') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          code: mode === 'rpc-missing' ? 'not_found' : 'unimplemented',
          message: 'fixture-private-diagnostic',
        }),
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"fixture":true}');
  });
});
server.listen(0, '127.0.0.1', () => {
  const port = (server.address() as AddressInfo).port;
  fs.writeFileSync(
    evidence,
    JSON.stringify({ pid: process.pid, port, updateDisabled: process.env.AGY_CLI_DISABLE_AUTO_UPDATE }),
  );
  fs.writeFileSync(
    log,
    `Starting language server process with pid ${mode === 'foreign-pid' ? process.pid + 1 : process.pid}\n` +
      `Language server listening on random port at 1 for HTTPS (gRPC)\nLanguage server listening on random port at ${port} for HTTP\n`,
  );
});
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    process.stdout.write(
      JSON.stringify({ id: message.id, result: { agentInfo: { name: 'Antigravity ACP Server' } } }) + '\n',
    );
  } else if (message.method === 'session/list') {
    if (mode === 'wait') return;
    const result = JSON.stringify({ id: message.id, error: { code: -32000, message: 'fixture-private-diagnostic' } });
    process.stdout.write(result + '\n' + (mode === 'malformed' ? 'invalid-json\n' : ''));
  } else throw new Error('不允许发送模型消息或创建会话');
});
lines.on('close', () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
