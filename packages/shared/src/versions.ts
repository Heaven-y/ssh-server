/** 版本记录仅作用于当前工作区的本地文件，提交 ID 为原生 Git 对象 ID。 */
export const VERSION_MESSAGE_MAX_LENGTH = 200;
export type VersionChange = {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
  /** 仅恢复预览使用：目标历史路径会覆盖当前未跟踪的同名文件。 */
  untrackedOverwrite?: boolean;
};
export type VersionExcluded = { path: string; reason: string };
export type VersionStatus = {
  initialized: boolean;
  head?: string;
  branch?: string;
  revision: string;
  changes: VersionChange[];
  excluded: VersionExcluded[];
};
/** timestamp 使用 Unix 毫秒，与网页其它时间字段一致。 */
export type VersionCommit = { id: string; subject: string; timestamp: number };
export type VersionHistory = { commits: VersionCommit[]; hasMore: boolean };
export type VersionDiff = { text: string; files: string[]; truncated: boolean; revision?: string };
export type VersionSaveInput = { message: string; revision: string };
export type VersionSaveResult = { created: boolean; commit?: VersionCommit; status: VersionStatus };
export type VersionRestoreInput = { commit: string; path?: string };
export type VersionRestorePreview = {
  commit: string;
  path?: string;
  revision: string;
  changes: VersionChange[];
  excluded: VersionExcluded[];
};
export type VersionRestoreResult = { restored: string[]; status: VersionStatus };
/** 放弃当前单文件差异，head 为空表示尚未创建首个提交。 */
export type VersionDiscardPreview = Omit<VersionRestorePreview, 'commit' | 'path'> & { head?: string; path: string };
export type VersionDiscardInput = { path: string; revision: string; confirmed: true };
