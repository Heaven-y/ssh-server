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
  revision: string;
  size: number;
};
export type WorkspaceFileInput = Pick<WorkspaceFile, 'path' | 'content' | 'revision'>;
export const MAX_EDITABLE_FILE_BYTES = 2 * 1024 * 1024;
