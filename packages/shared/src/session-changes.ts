/** 仅表示原生会话目录发生变动，不含会话正文、文件名或本机绝对路径。 */
export type SessionChangesSnapshot = {
  revision: number;
  /** 三个来源的主目录监听均正常才为 true；部分可用时 message 说明。 */
  watching: boolean;
  message?: string;
};
