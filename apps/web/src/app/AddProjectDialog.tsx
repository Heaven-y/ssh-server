import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderPlus } from 'lucide-react';
import { api, queryKeys } from '../lib/api';
import { DetailDialog } from '../ui/DetailDialog';
import { buttonClass, inputClass } from '../ui/styles';
import { useChat } from '../features/chat/chat-store';

/** 目录最后一段作为默认项目名；Windows 路径两种分隔符都要认。 */
function folderName(dir: string): string {
  const parts = dir
    .trim()
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

/**
 * 添加项目是一个动作：填绝对路径、校验存在即加入，没有分步向导与同步规则。
 * 目录是否真实存在由后端判定，失败在原处说明并保留输入。
 */
export function AddProjectDialog({ onClose }: { onClose(): void }) {
  const client = useQueryClient();
  const ids = useId();
  const [dir, setDir] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const created = await api.createProject({ name: name.trim() || folderName(dir), dir: dir.trim() });
      await client.invalidateQueries({ queryKey: queryKeys.workspaces });
      useChat.getState().selectWorkspace(created.id);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '添加项目失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <DetailDialog title="添加项目目录" busy={busy} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="text-xs leading-5 text-muted-foreground">
          项目就是本机一条绝对路径；加入只写本工具的配置，不动磁盘上的任何文件，也不动 CLI 的原生会话。
        </p>
        <div className="space-y-2">
          <label htmlFor={`${ids}-dir`} className="block text-sm font-medium">
            项目目录
          </label>
          <input
            id={`${ids}-dir`}
            value={dir}
            onChange={(event) => setDir(event.target.value)}
            placeholder="E:\web\demo"
            className={`${inputClass} font-mono text-xs`}
            autoFocus
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor={`${ids}-name`} className="block text-sm font-medium">
            项目名称
          </label>
          <input
            id={`${ids}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={folderName(dir) || '示例项目'}
            maxLength={100}
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground">留空时取目录最后一段。</p>
        </div>
        {error && (
          <p role="alert" className="text-sm leading-6 text-destructive-foreground">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={buttonClass('primary')} disabled={busy || !dir.trim()}>
            <FolderPlus aria-hidden className="size-4" />
            添加项目
          </button>
        </div>
      </form>
    </DetailDialog>
  );
}
