/** Windows 的原生后台更新器会另开控制台；只约束工作台子进程，不写用户配置或时间戳。 */
export function antigravityBackgroundEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') return env;
  const inherited = Object.fromEntries(
    Object.entries(env).filter(([name]) => name.toUpperCase() !== 'AGY_CLI_DISABLE_AUTO_UPDATE'),
  );
  // agy 1.5.1 严格识别字符串 true，1 不生效。
  return { ...inherited, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' };
}
