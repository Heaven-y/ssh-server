/** 原生工具名可能包含 MCP 服务器前缀，标题保留最后一段。 */
export const shortToolName = (name: string) => name.split('__').at(-1) ?? name;

const toolNames: Record<string, string> = {
  run_command: '执行命令',
  runcommand: '执行命令',
  bash: '执行命令',
  shell: '执行命令',
  exec_command: '执行命令',
  execute_command: '执行命令',
  commandexecution: '执行命令',
  read: '读取文件',
  read_file: '读取文件',
  view_file: '读取文件',
  viewfile: '读取文件',
  list_directory: '查看目录',
  list_dir: '查看目录',
  list_files: '查看目录',
  grep: '搜索内容',
  grep_search: '搜索内容',
  search: '搜索内容',
  search_files: '搜索文件',
  find_by_name: '查找文件',
  glob: '查找文件',
  websearch: '搜索网页',
  web_search: '搜索网页',
  webfetch: '读取网页',
  web_fetch: '读取网页',
  write: '写入文件',
  write_file: '写入文件',
  write_to_file: '写入文件',
  edit: '编辑文件',
  edit_file: '编辑文件',
  replace_file_content: '编辑文件',
  multi_replace_file_content: '编辑文件',
  apply_patch: '应用修改',
  filechange: '修改文件',
  notebookedit: '编辑笔记本',
  plan: '更新计划',
  update_plan: '更新计划',
  todowrite: '更新待办',
  agent: '运行子代理',
  task: '运行子代理',
  subagentactivity: '执行子代理任务',
  spawnagent: '启动子代理',
  spawn_agent: '启动子代理',
  imageview: '查看图片',
  manage_task: '管理后台任务',
  command_status: '查看命令状态',
  send_command_input: '发送命令输入',
};
export const toolDisplayName = (name: string) => toolNames[shortToolName(name).toLowerCase()] ?? shortToolName(name);

/** 只展示工具已公开的说明，不从参数推测模型意图。 */
export function toolDescription(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return;
  const values = input as Record<string, unknown>;
  const description = [values.toolSummary, values.Description, values.description].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  return typeof description === 'string' ? description.trim().slice(0, 500) : undefined;
}

const argumentKeys = [
  'command',
  'CommandLine',
  'file_path',
  'TargetFile',
  'AbsolutePath',
  'path',
  'pattern',
  'query',
  'url',
];

export function toolPrimaryArgument(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return;
  const values = input as Record<string, unknown>;
  const argument = argumentKeys.map((key) => values[key]).find((value) => typeof value === 'string');
  if (typeof argument === 'string') return argument;
  if (!Array.isArray(values.changes)) return;
  return values.changes
    .flatMap((change: unknown) => {
      if (!change || typeof change !== 'object' || !('path' in change) || typeof change.path !== 'string') return [];
      return [change.path];
    })
    .join(', ');
}
