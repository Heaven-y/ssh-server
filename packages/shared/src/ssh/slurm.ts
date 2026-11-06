/** 当前 SSH 账号的只读 squeue 文本快照；与登录节点资源采样分开。 */
export type SlurmSnapshot = {
  sampledAt: number;
  status: 'available' | 'unavailable' | 'error';
  output: string;
  truncated: boolean;
  message?: string;
};
