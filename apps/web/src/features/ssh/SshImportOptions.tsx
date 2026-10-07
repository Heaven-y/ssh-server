import { useQuery } from '@tanstack/react-query';
import type { ManualServerInput } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { buttonClass } from '../../ui/styles';

export function SshImportOptions({ select }: { select(input: ManualServerInput): void }) {
  const options = useQuery({
    queryKey: queryKeys.sshImportOptions,
    queryFn: ({ signal }) => api.sshImportOptions(signal),
    retry: false,
  });
  return (
    <section aria-label="SSH 配置导入" className="space-y-3">
      <p className="text-sm leading-6">
        从本机 ~/.ssh/config 填入表单。核对后明确保存才会成为可选服务器；不会修改 SSH 配置。
      </p>
      {options.isPending && <p role="status">正在读取 SSH 配置…</p>}
      {options.error && <p role="alert">{options.error.message}</p>}
      {options.data?.length === 0 && <p>未找到 SSH Host，可手动新增服务器。</p>}
      <ul className="space-y-2">
        {options.data?.map((host) => (
          <li key={host.alias} className="rounded border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="wrap-anywhere">
                {host.alias} · {host.user}@{host.hostname}:{host.port ?? 22}
              </span>
              <button
                type="button"
                className={buttonClass('outline')}
                disabled={!!host.unsupported.length}
                onClick={() =>
                  select({
                    name: host.name ?? host.alias,
                    hostname: host.hostname ?? host.alias,
                    username: host.user ?? '',
                    port: host.port ?? 22,
                    keyFile: host.keyFile,
                    authMode: 'key',
                  })
                }
              >
                填入表单
              </button>
            </div>
            {!!host.unsupported.length && <p className="mt-2 text-warning">暂不支持：{host.unsupported.join('、')}</p>}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={buttonClass('ghost')}
        disabled={options.isFetching}
        onClick={() => void options.refetch()}
      >
        重新读取 SSH 配置
      </button>
    </section>
  );
}
