/** 文件接口仅接受工作区内的相对路径，正文不进入持久浏览器存储。 */
export type WorkspaceFileEntry = {
  path: string;
  name: string;
  kind: 'file' | 'directory';
  size?: number;
};
export type WorkspaceDirectory = {
  path: string;
  entries: WorkspaceFileEntry[];
  truncated: boolean;
};
export type WorkspaceFile = {
  path: string;
  content: string;
  size: number;
};
/** 网页只读查看本地副本的正文上限；目录列表共用该阈值。 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
