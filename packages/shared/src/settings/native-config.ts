/** 原生配置接口只允许预定义 Agent，不接受浏览器提供文件路径。 */
export type NativeConfigAgent = 'claude' | 'codex';
export type NativeConfigDocument = {
  agent: NativeConfigAgent;
  displayPath: string;
  format: 'json' | 'toml';
  content: string;
  revision: string;
  exists: boolean;
};
export type NativeConfigInput = { content: string; revision: string };
