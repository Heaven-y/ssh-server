import {
  at,
  projectBase,
  userBase,
  type Base,
  type Builder,
  type ResourceContext,
} from '../../common/configuration/resources';
function agyCustomizations(base: Base, output: Builder) {
  output.file(base, 'mcp_config.json', 'mcp', 'Antigravity 原生 MCP 配置；连接与启停由 CLI 管理。');
  output.file(base, 'hooks.json', 'hooks');
  output.file(base, 'rules.json', 'rules', '原生规则发现清单；继承、排除和外部路径由 CLI 解析。');
  output.file(base, 'skills.json', 'skills', '原生 Skills 发现清单；继承、排除和外部路径由 CLI 解析。');
  output.file(base, 'plugins.json', 'plugins', '原生插件发现清单；这里不执行安装或启停。');
  output.scan(base, 'rules', 'rules', true);
  output.scan(base, 'skills', 'skills', true);
}

export function antigravityPlan(context: ResourceContext, output: Builder) {
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
