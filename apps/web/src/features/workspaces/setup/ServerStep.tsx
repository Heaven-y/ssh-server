import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WorkspaceInput } from '@ssh-server/shared';
import { api, queryKeys } from '../../../lib/api';
import { buttonClass, inputClass } from '../../../ui/styles';
import { ServerManagerDialog } from '../../ssh/ServerManagerDialog';

export function ServerStep({ input, change }: { input: WorkspaceInput; change(patch: Partial<WorkspaceInput>): void }) {
  const id = useId();
  const [managing, setManaging] = useState(false);
  const hosts = useQuery({
    queryKey: queryKeys.sshHosts,
    queryFn: ({ signal }) => api.listSshHosts(signal),
    retry: false,
  });
  const selected = hosts.data?.find((host) => host.alias === input.sshHost);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor={id} className="mb-2 block text-sm font-medium">
          服务器
        </label>
        <select
          id={id}
          className={inputClass}
          value={input.sshHost}
          disabled={hosts.isPending}
          onChange={(event) => change({ sshHost: event.target.value })}
        >
          <option value="">{hosts.isPending ? '正在读取…' : '请选择已保存服务器'}</option>
          {hosts.data?.map((host) => (
            <option key={host.alias} value={host.alias}>
              {host.name} · {host.username}@{host.hostname}:{host.port}
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <p className="text-sm text-muted-foreground">认证由服务器档案统一管理；工作区浏览与验证会复用该服务器连接。</p>
      )}
      {hosts.isError && (
        <p role="alert" className="text-sm text-destructive-foreground">
          服务器列表读取失败：{hosts.error.message}
        </p>
      )}
      {hosts.data?.length === 0 && <p className="text-sm">尚未配置服务器，请先打开服务器管理新增或导入。</p>}
      <button type="button" className={`${buttonClass('outline')} self-start`} onClick={() => setManaging(true)}>
        管理服务器
      </button>
      <p className="text-xs leading-5 text-muted-foreground">
        新增、修改认证或输入密码请使用同一管理入口，关闭后保留本次工作区草稿。无需为每个工作区重复测试连接。
      </p>
      {managing && (
        <ServerManagerDialog
          initialAlias={input.sshHost}
          onClose={() => setManaging(false)}
          onSelect={(sshHost) => change({ sshHost })}
        />
      )}
    </div>
  );
}
