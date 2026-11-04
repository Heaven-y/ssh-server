import type { ManagedServer } from '@agentdeck/shared';
import { Plus } from 'lucide-react';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass } from '../../ui/styles';

export function ConsoleServerPicker({
  servers,
  close,
  select,
  manage,
}: {
  servers: ManagedServer[];
  close(): void;
  select(alias: string): void;
  manage(): void;
}) {
  return (
    <DetailDialog title="打开服务器" onClose={close}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted-foreground">
          选择已保存的服务器。连接状态与认证由服务器档案统一管理。
        </p>
        {servers.length ? (
          <ul className="space-y-2">
            {servers.map((server) => (
              <li key={server.alias}>
                <button
                  type="button"
                  aria-label={`打开 ${server.name}`}
                  className="w-full space-y-1 rounded-lg border border-border p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => select(server.alias)}
                >
                  <span className="block text-sm font-medium">{server.name}</span>
                  <span className="block break-all font-mono text-xs text-muted-foreground">
                    {server.alias} · {server.username}@{server.hostname}:{server.port}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">尚未添加服务器。</p>
        )}
        <button type="button" className={buttonClass('outline')} onClick={manage}>
          <Plus aria-hidden className="size-4" />
          管理服务器档案
        </button>
      </div>
    </DetailDialog>
  );
}
