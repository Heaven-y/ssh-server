import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { WorkspaceRemovalInput, WorkspaceRemovalPreview, WorkspaceRemovalResult } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass } from '../../ui/styles';
import { finishWorkspaceRemoval } from './removal-client';

function removalReady(preview: UseQueryResult<WorkspaceRemovalPreview>) {
  return !!preview.data && !preview.isFetching && !preview.isError && !preview.data.blockers.length;
}

function RemovalPreview({ preview }: { preview: UseQueryResult<WorkspaceRemovalPreview> }) {
  const workspace = preview.data?.workspace;
  return (
    <>
      {workspace ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm leading-6">
          <dt className="text-muted-foreground">工作区</dt>
          <dd className="break-all font-medium">{workspace.name}</dd>
          <dt className="text-muted-foreground">本地副本</dt>
          <dd className="break-all">{workspace.localDir}</dd>
          <dt className="text-muted-foreground">SSH 目标</dt>
          <dd className="break-all">{workspace.sshHost}</dd>
          <dt className="text-muted-foreground">远端目录</dt>
          <dd className="break-all">{workspace.remoteDir}</dd>
        </dl>
      ) : null}
      <p className="text-sm leading-6 text-muted-foreground">
        移除这项连接配置，关闭它的终端和文件视图。两端项目文件、Git 记录、原生对话历史、服务器配置和凭据都会保留。
      </p>
      {preview.isFetching ? (
        <p role="status" className="text-sm">
          正在核对当前配置与活动…
        </p>
      ) : null}
      {preview.data?.blockers.length ? (
        <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm leading-6">
          <p className="font-medium">请先处理以下事项</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {preview.data.blockers.map((blocker) => (
              <li key={blocker.code}>{blocker.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export function WorkspaceRemoveDialog({
  workspaceId,
  onClose,
  onRemoved,
}: {
  workspaceId: string;
  onClose(): void;
  onRemoved(id: string, result: WorkspaceRemovalResult): void;
}) {
  const checkboxId = useId();
  const client = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const submitting = useRef(false);
  const errorElement = useRef<HTMLParagraphElement>(null);
  const preview = useQuery({
    queryKey: queryKeys.workspaceRemoval(workspaceId),
    queryFn: ({ signal }) => api.previewWorkspaceRemoval(workspaceId, signal),
    retry: false,
    gcTime: 0,
  });
  const remove = useMutation({
    mutationFn: (input: WorkspaceRemovalInput) => api.removeWorkspace(workspaceId, input),
    onSuccess: async (result) => {
      await finishWorkspaceRemoval(client, workspaceId);
      // 宿主可能仍保留独立文件面板；业务收尾不能随弹窗卸载而跳过。
      onRemoved(workspaceId, result);
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const failure = remove.error ?? preview.error;
  useEffect(() => {
    if (failure) errorElement.current?.focus();
  }, [failure]);
  const ready = removalReady(preview);
  const close = () => {
    if (!submitting.current) onClose();
  };
  return (
    <DetailDialog title="移除工作区" onClose={close} busy={remove.isPending}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmed || !ready || !preview.data || submitting.current) return;
          submitting.current = true;
          remove.mutate({ configuration: preview.data.configuration, confirmed: true });
        }}
      >
        <RemovalPreview preview={preview} />
        {failure ? (
          <p ref={errorElement} tabIndex={-1} role="alert" className="text-sm leading-6 text-destructive-foreground">
            {failure.message}
          </p>
        ) : null}
        <label
          htmlFor={checkboxId}
          className="flex min-h-11 items-start gap-3 rounded-lg border border-border p-3 text-sm leading-6"
        >
          <input
            id={checkboxId}
            type="checkbox"
            className="mt-1 size-4 shrink-0"
            checked={confirmed}
            disabled={!ready || remove.isPending}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>我已核对目标，确认移除这项工作区配置。</span>
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClass('ghost')} disabled={remove.isPending} onClick={close}>
            取消
          </button>
          <button
            type="button"
            className={buttonClass('outline')}
            disabled={preview.isFetching || remove.isPending}
            onClick={() => {
              setConfirmed(false);
              remove.reset();
              void preview.refetch();
            }}
          >
            重新核对
          </button>
          <button type="submit" className={buttonClass('danger')} disabled={!confirmed || !ready || remove.isPending}>
            {remove.isPending ? '正在移除…' : '移除配置'}
          </button>
        </div>
      </form>
    </DetailDialog>
  );
}
