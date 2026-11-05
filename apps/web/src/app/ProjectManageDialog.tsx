import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Workspace } from '@agentdeck/shared';
import { api, queryKeys } from '../lib/api';
import { useChat } from '../features/chat/chat-store';
import { DetailDialog } from '../ui/DetailDialog';
import { buttonClass, inputClass } from '../ui/styles';
import {
  clearProjectQueries,
  projectIsBusy,
  refreshProjectSessionLists,
  updateProjectCache,
  useProjectBusy,
  type ProjectManageAction,
} from './project-management';

const titles: Record<ProjectManageAction, string> = {
  rename: '重命名项目',
  directory: '更换项目目录',
  remove: '移除项目',
};
const buttons: Record<ProjectManageAction, string> = {
  rename: '保存项目名称',
  directory: '更换目录',
  remove: '确认移除项目',
};
const projectError = (reason: unknown) => (reason instanceof Error ? reason.message : '项目操作失败，请重试。');
type Props = { project: Workspace; action: ProjectManageAction; onClose(): void };
function useProjectManage({ project, action, onClose }: Props) {
  const client = useQueryClient();
  const blocked = useProjectBusy(project.id);
  const initial = action === 'directory' ? project.dir : project.name;
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = action !== 'remove' && value !== initial;
  const close = () => {
    if (!lock.current && (!dirty || window.confirm('项目设置有未保存修改，确定放弃吗？'))) onClose();
  };
  const remove = async () => {
    await api.deleteProject(project.id);
    await client.cancelQueries({ queryKey: queryKeys.workspaces });
    const remaining = (client.getQueryData<Workspace[]>(queryKeys.workspaces) ?? []).filter(
      (item) => item.id !== project.id,
    );
    useChat.getState().removeWorkspace(project.id, remaining[0]?.id);
    client.setQueryData(queryKeys.workspaces, remaining);
    await clearProjectQueries(client, project.id);
    await refreshProjectSessionLists(client);
    void client.invalidateQueries({ queryKey: queryKeys.workspaces });
  };
  const save = async () => {
    const selection = useChat.getState().conversationVersion;
    const patch = action === 'rename' ? { name: value.trim() } : { dir: value.trim() };
    const updated = await api.updateProject(project.id, patch);
    if (action === 'directory') {
      useChat.getState().resetWorkspaceConversation(project.id, selection);
      await clearProjectQueries(client, project.id);
    }
    await updateProjectCache(client, updated);
    if (action === 'directory') await refreshProjectSessionLists(client);
  };
  const submit = async () => {
    if (lock.current || projectIsBusy(client, project.id)) return;
    if (action !== 'remove' && !value.trim()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (action === 'remove') await remove();
      else await save();
      if (mounted.current) onClose();
    } catch (reason) {
      if (mounted.current) setError(projectError(reason));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { value, setValue, dirty, busy, error, blocked, submit, close };
}

export function ProjectManageDialog(props: Props) {
  const state = useProjectManage(props);
  const { action, project } = props;
  return (
    <DetailDialog title={titles[action]} busy={state.busy} onClose={state.close}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void state.submit();
        }}
      >
        <p className="text-sm font-medium">{project.name}</p>
        {action === 'remove' ? (
          <p className="text-sm leading-6">
            只移除本工具中的项目记录，<strong>不删除磁盘目录</strong>，也不删除 CLI 原生会话。以后可重新添加该目录。
          </p>
        ) : (
          <ProjectField
            action={action}
            project={project}
            value={state.value}
            change={state.setValue}
            disabled={state.busy || state.blocked}
          />
        )}
        {state.blocked && (
          <p role="status" className="text-sm text-muted-foreground">
            会话正在运行、准备发送或执行管理操作，请结束后再修改项目。
          </p>
        )}
        {state.error && (
          <p role="alert" className="text-sm text-destructive-foreground">
            {state.error}
          </p>
        )}
        <ProjectManageFooter action={action} state={state} />
      </form>
    </DetailDialog>
  );
}
function ProjectManageFooter({
  action,
  state,
}: {
  action: ProjectManageAction;
  state: ReturnType<typeof useProjectManage>;
}) {
  const invalid = action !== 'remove' && (!state.value.trim() || !state.dirty);
  return (
    <div className="flex justify-end gap-2 border-t border-border pt-4">
      <button type="button" className={buttonClass('ghost')} disabled={state.busy} onClick={state.close}>
        取消
      </button>
      <button
        type="submit"
        className={buttonClass(action === 'remove' ? 'danger' : 'primary')}
        disabled={state.busy || state.blocked || invalid}
      >
        {state.busy ? '正在处理…' : buttons[action]}
      </button>
    </div>
  );
}
function ProjectField({
  action,
  project,
  value,
  change,
  disabled,
}: {
  action: 'rename' | 'directory';
  project: Workspace;
  value: string;
  change(value: string): void;
  disabled: boolean;
}) {
  const id = useId();
  const directory = action === 'directory';
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {directory ? '项目目录' : '项目名称'}
      </label>
      <input
        id={id}
        className={`${inputClass} ${directory ? 'font-mono text-xs' : ''}`}
        autoFocus
        required
        maxLength={directory ? undefined : 100}
        value={value}
        disabled={disabled}
        onChange={(event) => change(event.target.value)}
      />
      <p className="break-all text-xs leading-5 text-muted-foreground">
        {directory
          ? `当前目录：${project.dir}。保存后重新发现会话，并清除当前项目已打开的旧会话及参数。磁盘文件不移动。`
          : '仅修改列表中的显示名称。目录离线时也可改名。'}
      </p>
    </div>
  );
}
