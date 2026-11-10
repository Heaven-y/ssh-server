// stdio 的 stdout 专供 MCP；启动失败只写固定消息，不回显命令行和原生诊断。
import { startSessionToolsStdio } from './mcp';
import { createSessionToolsRuntime, sessionToolsConfigDir } from './runtime';

async function main() {
  const runtime = createSessionToolsRuntime(sessionToolsConfigDir(process.argv.slice(2)));
  const connection = await startSessionToolsStdio(runtime);
  const shutdown = () => {
    void connection.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main().catch(() => {
  process.stderr.write('会话阅读工具启动失败，请检查配置目录和本机运行环境。\n');
  process.exitCode = 1;
});
