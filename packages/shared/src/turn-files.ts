// 轮次文件变更：由原生工具事件聚合，也可由状态对比补齐；不依赖 Git 对象。
import type { VersionChange } from './versions';

export type TurnFileChange = VersionChange & {
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  /** 原生 unified diff；由命令或外部改动产生时缺省 */
  diff?: string;
  /** 是否由 Agent 的编辑工具直接产生，否则为本轮状态对比发现的改动 */
  viaTool: boolean;
};
