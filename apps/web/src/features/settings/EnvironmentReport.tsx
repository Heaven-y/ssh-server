import { settingsApi, settingsKeys } from './api';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { AgentKind } from '@agentdeck/shared/conversation';

import { buttonClass } from '../../ui/styles';
import { useCancelableRequest } from '../../lib/use-cancelable-request';
import { agentTool, useEnvironment } from './use-environment';
import { CliInstallationPanel } from './CliInstallationPanel';
import { cliInstallationKey } from './cli-installation-api';

const agents: AgentKind[] = ['claude', 'codex', 'antigravity'];
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
      await qc.cancelQueries({ queryKey: settingsKeys.environment });
      return settingsApi.detectEnvironment(signal);
    });
    if (report) {
      qc.setQueryData(settingsKeys.environment, report);
      await Promise.all(agents.map((agent) => qc.invalidateQueries({ queryKey: cliInstallationKey(agent) })));
    }
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
        “重新检测”检查本机 CLI 是否可用；各卡片的“检查更新”联网查询官方最新版本。
      </p>
      {query.isPending && <p role="status">正在读取环境…</p>}
      {(request.error || query.error) && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {request.error ?? query.error?.message}
        </p>
      )}
      {query.data && (
        <p className="text-xs text-muted-foreground">
          检测时间：{new Date(query.data.checkedAt).toLocaleString('zh-CN')}
        </p>
      )}
      <div className="space-y-2">
        {agents.map((agent) => (
          <CliInstallationPanel
            key={agent}
            agent={agent}
            health={agentTool(query.data, agent)}
            disabled={disabled || request.busy}
          />
        ))}
      </div>
    </section>
  );
}
