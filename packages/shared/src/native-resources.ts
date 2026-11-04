import type { AgentKind } from './agents';

export type NativeResourceKind = 'settings' | 'rules' | 'skills' | 'mcp' | 'plugins' | 'hooks';
export type NativeResourceScope = 'user' | 'project' | 'local' | 'directory';
export type NativeResourceFormat = 'json' | 'toml' | 'markdown' | 'text';

/** 目录只有元数据；id 由服务端生成，不能用路径代替。 */
export type NativeResource = {
  id: string;
  agent: AgentKind;
  kind: NativeResourceKind;
  scope: NativeResourceScope;
  label: string;
  displayPath: string;
  format: NativeResourceFormat;
  exists: boolean;
  editable: boolean;
  description: string;
  unavailableReason?: string;
};

/** 只在预定义目录内创建一个规则文件或一个 Skill 的 SKILL.md。 */
export type NativeResourceRoot = {
  id: string;
  kind: 'rules' | 'skills';
  scope: NativeResourceScope;
  label: string;
  displayPath: string;
  editable: boolean;
  unavailableReason?: string;
};

export type NativeResourceGuidance = {
  label: string;
  description: string;
  command?: string;
};

export type NativeResourceCatalog = {
  agent: AgentKind;
  projectId?: string;
  entries: NativeResource[];
  roots: NativeResourceRoot[];
  guidance: NativeResourceGuidance[];
  warnings: string[];
};

/** 仅显式打开返回正文；前端应保存在编辑器局部状态，关闭时释放。 */
export type NativeResourceDocument = {
  resource: NativeResource;
  content: string;
  revision: string;
};
export type NativeResourceSaveInput = { content: string; revision: string };
export type NativeResourceCreateInput = { rootId: string; name: string; content: string };
/** 保存不回显正文，避免常规变更响应再次携带敏感值。 */
export type NativeResourceSaved = { resource: NativeResource; revision: string };
