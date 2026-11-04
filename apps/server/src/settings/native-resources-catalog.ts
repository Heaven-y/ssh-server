import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  AgentKind,
  NativeResource,
  NativeResourceGuidance,
  NativeResourceKind,
  NativeResourceRoot,
  NativeResourceScope,
} from '@agentdeck/shared';

type Base = { directory: string; displayPath: string; scope: NativeResourceScope };
export type ResourceTarget = Omit<NativeResource, 'exists' | 'editable'> & { file: string };
export type ResourceRoot = Omit<NativeResourceRoot, 'editable'> & { directory: string };
export type ResourceScan = Base & { mode: 'rules' | 'skills' | 'policy' | 'plugins' };
export type ResourcePlan = {
  targets: ResourceTarget[];
  roots: ResourceRoot[];
  scans: ResourceScan[];
  guidance: NativeResourceGuidance[];
};
export type ResourceContext = {
  agent: AgentKind;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  project?: { id: string; dir: string };
};

export function resourcePathKey(file: string): string {
  const resolved = path.resolve(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function resourceId(agent: AgentKind, file: string, kind = 'file'): string {
  return createHash('sha256')
    .update(JSON.stringify([agent, kind, resourcePathKey(file)]))
    .digest('hex');
}

function at(base: Base, relative: string): Base {
  return {
    ...base,
    directory: path.join(base.directory, relative),
    displayPath: path.posix.join(base.displayPath, relative.split(path.sep).join('/')),
  };
}

export function makeResourceTarget(
  agent: AgentKind,
  base: Base,
  relative: string,
  details: { kind: NativeResourceKind; label?: string; description?: string },
): ResourceTarget {
  const location = at(base, relative);
  const suffix = path.extname(relative).toLowerCase();
  const format = suffix === '.json' ? 'json' : suffix === '.toml' ? 'toml' : suffix === '.md' ? 'markdown' : 'text';
  return {
    id: resourceId(agent, location.directory),
    agent,
    kind: details.kind,
    scope: base.scope,
    label: details.label ?? relative,
    displayPath: location.displayPath,
    format,
    description: details.description ?? '保存原生文件；加载时机、信任与权限由 CLI 决定。',
    file: location.directory,
  };
}

function builder(context: ResourceContext) {
  const plan: ResourcePlan = { targets: [], roots: [], scans: [], guidance: [] };
  const file = (base: Base, relative: string, kind: NativeResourceKind, description?: string) => {
    plan.targets.push(makeResourceTarget(context.agent, base, relative, { kind, description }));
  };
  const scan = (base: Base, relative: string, mode: ResourceScan['mode'], create = false) => {
    const location = at(base, relative);
    plan.scans.push({ ...location, mode });
    if (create && (mode === 'rules' || mode === 'skills'))
      plan.roots.push({
        id: resourceId(context.agent, location.directory, mode),
        kind: mode,
        scope: base.scope,
        label: mode === 'rules' ? '规则目录' : 'Skills 目录',
        displayPath: location.displayPath,
        directory: location.directory,
      });
  };
  return { plan, file, scan };
}
type Builder = ReturnType<typeof builder>;

function userBase(context: ResourceContext, folder: string, override?: string): Base {
  return {
    directory: path.resolve(override || path.join(context.homeDir, folder)),
    displayPath: override ? path.resolve(override) : `~/${folder}`,
    scope: 'user',
  };
}
function projectBase(context: ResourceContext): Base | undefined {
  return context.project
    ? { directory: path.resolve(context.project.dir), displayPath: '', scope: 'project' }
    : undefined;
}

function claudePlan(context: ResourceContext, output: Builder) {
  const user = userBase(context, '.claude', context.env.CLAUDE_CONFIG_DIR);
  output.file(user, 'settings.json', 'settings', 'Claude 用户设置，含权限、环境和原生插件选择；保留未知字段。');
  output.file(user, 'CLAUDE.md', 'rules');
  output.scan(user, 'rules', 'rules', true);
  output.scan(user, 'skills', 'skills', true);
  const project = projectBase(context);
  if (project) {
    const local: Base = { ...project, scope: 'local' };
    output.file(project, '.claude/settings.json', 'settings', '项目共享设置；原生 user、project、local 层保持独立。');
    output.file(local, '.claude/settings.local.json', 'settings', '仅本机使用的项目设置，通常不提交版本控制。');
    for (const name of ['CLAUDE.md', '.claude/CLAUDE.md']) output.file(project, name, 'rules');
    output.file(local, 'CLAUDE.local.md', 'rules', '个人项目规则，保留 Claude 原生 local 作用域。');
    output.file(
      project,
      'AGENTS.md',
      'rules',
      '新版本 Claude 的条件回退入口；是否加载由原生版本与已有 CLAUDE 文件决定。',
    );
    output.file(project, '.mcp.json', 'mcp', '项目 MCP 配置；是否启动或批准服务器仍由 Claude 决定。');
    output.scan(project, '.claude/rules', 'rules', true);
    output.scan(project, '.claude/skills', 'skills', true);
  }
  output.plan.guidance.push(
    {
      label: '用户与个人项目 MCP',
      description: '原生保存在混合状态文件中，请使用 CLI 管理。list/get 可能连接已批准的服务器。',
      command: 'claude mcp --help',
    },
    {
      label: 'Claude 原生插件',
      description: '原生支持 user、project、local 作用域；安装缓存不作为配置文件编辑。',
      command: 'claude plugin --help',
    },
  );
}

function codexPlan(context: ResourceContext, output: Builder) {
  const user = userBase(context, '.codex', context.env.CODEX_HOME);
  output.file(
    user,
    'config.toml',
    'settings',
    'Codex 用户配置，同时管理 MCP、模型、权限和原生插件；不另造一份默认配置。',
  );
  for (const name of ['AGENTS.md', 'AGENTS.override.md']) output.file(user, name, 'rules');
  output.scan(user, 'rules', 'policy');
  output.scan(userBase(context, '.agents'), 'skills', 'skills', true);
  const project = projectBase(context);
  if (project) {
    output.file(
      project,
      '.codex/config.toml',
      'settings',
      '项目原生配置；只有项目获 Codex 信任后才加载，保存不代表批准。',
    );
    for (const name of ['AGENTS.md', 'AGENTS.override.md']) output.file(project, name, 'rules');
    output.scan(project, '.codex/rules', 'policy');
    output.scan(project, '.agents/skills', 'skills', true);
  }
  output.plan.guidance.push(
    {
      label: 'Codex MCP',
      description: 'MCP 位于对应 config.toml 的 mcp_servers 表；也可通过原生命令管理。',
      command: 'codex mcp --help',
    },
    {
      label: 'Codex 原生插件',
      description: '通过原生插件管理器维护；插件缓存不直接编辑，清单命令可能访问 marketplace。',
      command: 'codex plugin --help',
    },
    {
      label: '命令规则',
      description:
        '.rules 使用 Starlark；此编辑器只检查 UTF-8 与文件大小，规则语法由原生 CLI 验证，修改后需下次启动加载。',
    },
  );
}

function agyCustomizations(base: Base, output: Builder) {
  output.file(base, 'mcp_config.json', 'mcp', 'Antigravity 原生 MCP 配置；连接与启停由 CLI 管理。');
  output.file(base, 'hooks.json', 'hooks');
  output.file(base, 'rules.json', 'rules', '原生规则发现清单；继承、排除和外部路径由 CLI 解析。');
  output.file(base, 'skills.json', 'skills', '原生 Skills 发现清单；继承、排除和外部路径由 CLI 解析。');
  output.file(base, 'plugins.json', 'plugins', '原生插件发现清单；这里不执行安装或启停。');
  output.scan(base, 'rules', 'rules', true);
  output.scan(base, 'skills', 'skills', true);
}

function antigravityPlan(context: ResourceContext, output: Builder) {
  const user = userBase(context, '.gemini');
  output.file(
    user,
    'antigravity-cli/settings.json',
    'settings',
    'Antigravity CLI 全局设置；不创建未经原生支持的项目 settings 层。',
  );
  for (const name of ['AGENTS.md', 'GEMINI.md', 'config/AGENTS.md', 'config/GEMINI.md'])
    output.file(user, name, 'rules');
  agyCustomizations(at(user, 'config'), output);
  output.file(user, 'config/config.json', 'plugins', '原生插件启停等用户选择；实际加载由 CLI 决定。');
  output.scan(user, 'antigravity-cli/skills', 'skills');
  output.scan(user, 'skills', 'skills');
  const project = projectBase(context);
  if (project) {
    for (const name of ['AGENTS.md', 'GEMINI.md']) output.file(project, name, 'rules');
    agyCustomizations(at(project, '.agents'), output);
    // 只开放项目内维护的普通插件目录；全局安装资产与目录链接不进入编辑器。
    output.scan(project, '.agents/plugins', 'plugins');
    output.scan(project, '.agent/skills', 'skills');
  }
  output.plan.guidance.push(
    {
      label: 'Antigravity MCP',
      description: '全局 config/mcp_config.json、项目 .agents/mcp_config.json 和插件内配置各保留原生作用域。',
      command: 'agy mcp --help',
    },
    {
      label: 'Antigravity 原生插件',
      description: '原生命令管理安装与启停；全局安装资产不直接编辑，项目自有插件只开放配置和规则文件。',
      command: 'agy plugin --help',
    },
  );
}

export function resourcePlan(context: ResourceContext): ResourcePlan {
  const output = builder(context);
  const builders = { claude: claudePlan, codex: codexPlan, antigravity: antigravityPlan };
  builders[context.agent](context, output);
  output.plan.guidance.push({
    label: '原生发现范围',
    description: '列出标准文件与有界目录资源；自定义路径、继承、组织策略和实际生效顺序仍由 CLI 处理。',
  });
  return output.plan;
}
