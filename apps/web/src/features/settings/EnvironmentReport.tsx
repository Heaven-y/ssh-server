import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { EnvironmentTool } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { useCancelableRequest } from '../workspaces/setup/use-cancelable-request';
import { useEnvironment } from './use-environment';

const GUIDES: Record<EnvironmentTool['name'], { url: string; hint: string }> = {
  'Node.js': { url: 'https://nodejs.org/en/download', hint: '安装 Node.js，并从可执行 node 的终端重新启动本机服务。' },
  'Claude Code': {
    url: 'https://code.claude.com/docs/en/setup',
    hint: '按官方说明安装并配置 Claude Code；原生配置位于 ~/.claude/。只需安装你使用的 Agent。',
  },
  Codex: {
    url: 'https://developers.openai.com/codex/cli/',
    hint: '按官方说明安装 Codex CLI；原生配置位于 ~/.codex/config.toml。只需安装你使用的 Agent。',
  },
  git: { url: 'https://git-scm.com/downloads', hint: '安装 Git，并确保本机服务进程的 PATH 可以找到 git。' },
  rclone: {
    url: 'https://rclone.org/install/',
    hint: '按官方说明安装 rclone，并将可执行文件目录加入本机服务进程的 PATH。',
  },
};
export function EnvironmentSummary({ onOpenSettings }: { onOpenSettings(): void }) {
  const query = useEnvironment();
  const missing = query.data?.tools.filter((tool) => !tool.available) ?? [];
  if (query.isSuccess && missing.length === 0) return null;
  return (
    <section
      aria-label="启动环境摘要"
      className="flex shrink-0 flex-wrap items-center gap-x-3 border-b border-border px-4 py-1 text-xs leading-6"
    >
      <p role="status">
        {query.isPending
          ? '正在读取环境…'
          : query.isError
            ? '环境读取失败'
            : `缺少或不可用：${missing.map((tool) => tool.name).join('、')}`}
      </p>
      {(query.isError || !!missing.length) && (
        <button type="button" className={`${buttonClass('ghost')} text-xs`} onClick={onOpenSettings}>
          查看设置
        </button>
      )}
    </section>
  );
}
export function EnvironmentReport({ disabled }: { disabled: boolean }) {
  const query = useEnvironment();
  const request = useCancelableRequest();
  const qc = useQueryClient();
  const check = async () => {
    if (disabled || request.busy) return;
    const report = await request.run(async (signal) => {
      await qc.cancelQueries({ queryKey: queryKeys.environment });
      return api.detectEnvironment(signal);
    });
    if (report) qc.setQueryData(queryKeys.environment, report);
  };
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">本机运行环境</h3>
        <button
          type="button"
          className={buttonClass('outline')}
          disabled={request.busy || disabled}
          onClick={() => void check()}
        >
          <RefreshCw aria-hidden className={`size-4 ${request.busy ? 'motion-safe:animate-spin' : ''}`} />
          {request.busy ? '正在检测…' : '重新检测'}
        </button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        检查本机工具的可用状态。安装或配置后可重新检测；修改 PATH 后可能需要重启本机服务。
      </p>
      {query.isPending && <p role="status">正在读取环境…</p>}
      {(request.error || query.error) && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {request.error ?? query.error?.message}
        </p>
      )}
      {query.data && (
        <>
          <p className="text-xs text-muted-foreground">
            检测时间：{new Date(query.data.checkedAt).toLocaleString('zh-CN')}
          </p>
          <ul className="space-y-2 text-sm">
            {query.data.tools.map((tool) => (
              <li key={tool.name} className="rounded border border-border p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>{tool.name}</span>
                  <span className={tool.available ? 'text-success' : 'text-warning'}>
                    {tool.available ? `可用 · ${tool.version ?? '版本未知'}` : '不可用'}
                  </span>
                </div>
                {tool.message && <p className="mt-1 text-xs leading-5 text-muted-foreground">{tool.message}</p>}
                {!tool.available && (
                  <div className="mt-2 space-y-1 text-xs leading-5">
                    <p>{GUIDES[tool.name].hint}</p>
                    <a className="text-accent underline" href={GUIDES[tool.name].url} target="_blank" rel="noreferrer">
                      {tool.name} 官方安装与配置
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
