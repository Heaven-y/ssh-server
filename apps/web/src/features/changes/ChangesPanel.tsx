import { useId } from 'react';
import type { TurnChangesRecord, TurnFileChange, VersionChange } from '@ssh-server/shared';
import { buttonClass, inputClass } from '../../ui/styles';
import { ExcludedList } from '../versions/VersionLists';
import { DiffView } from './DiffView';
import { DiscardConfirmation } from './DiscardConfirmation';
import { useChangesPanel, type ChangesPanelInput, type ChangesPanelModel } from './use-changes-panel';

const kindLabel = { added: '新增', modified: '修改', deleted: '删除' };
function recordLabel(record: TurnChangesRecord): string {
  const changes = record.phase === 'unavailable' ? '不可用' : `${record.changes.length}个文件`;
  return `${new Date(record.startedAt).toLocaleTimeString()} · ${changes}${record.phase === 'incomplete' ? ' · 不完整' : ''}`;
}
function fileLabel(file: VersionChange | TurnFileChange): string {
  if (!('binary' in file)) return kindLabel[file.kind];
  return `${kindLabel[file.kind]} · ${file.binary ? '二进制' : `+${file.additions} −${file.deletions}`}`;
}

function ChangeControls({ model }: { model: ChangesPanelModel }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="block text-xs">
        比较来源
        <select
          id={id}
          aria-label="比较来源"
          className={`${inputClass} mt-1`}
          value={model.selection.turnId ?? ''}
          disabled={model.discard.busy}
          onChange={(event) => model.choose({ turnId: event.target.value || undefined })}
        >
          <option value="">相对上次保存版本</option>
          {model.selection.turnId && !model.record && <option value={model.selection.turnId}>此轮记录不可用</option>}
          {model.turns.records.map((record) => (
            <option key={record.turnId} value={record.turnId}>
              {recordLabel(record)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass('outline')} disabled={model.discard.busy} onClick={model.refresh}>
          刷新改动
        </button>
        {!model.selection.turnId && model.path && (
          <button
            type="button"
            className={buttonClass('danger')}
            disabled={model.discard.busy}
            onClick={() => {
              void model.discard.prepare(model.path!);
            }}
          >
            预览放弃此文件
          </button>
        )}
      </div>
    </>
  );
}
function ChangeNotices({ model, dirty }: { model: ChangesPanelModel; dirty: boolean }) {
  return (
    <>
      {!model.turns.current && (
        <p role="status" className="text-xs text-warning">
          此文件面板属于另一工作区；选择对应对话后可查看本轮改动或添加反馈。
        </p>
      )}
      {model.record?.message && (
        <p role="status" className="text-xs leading-5 text-warning">
          {model.record.message}
        </p>
      )}
      {!model.turns.records.length && model.turns.current && (
        <p className="text-xs text-muted-foreground">此会话尚无已保存的本轮快照；未采集的历史不会用当前差异替代。</p>
      )}
      {model.error && (
        <p role="alert" className="text-xs text-destructive-foreground">
          {model.error instanceof Error ? model.error.message : '读取失败，请重试'}
        </p>
      )}
      {dirty && <p className="text-xs text-warning">本地编辑器有未保存内容；差异与放弃仅作用于磁盘，编辑缓冲保留。</p>}
    </>
  );
}
function ChangeFiles({ model }: { model: ChangesPanelModel }) {
  return (
    <>
      {(model.status.isFetching || model.diff.isFetching) && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取改动…
        </p>
      )}
      <ul className="max-h-48 space-y-1 overflow-auto" aria-label="改动文件">
        {model.changes.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${model.path === file.path ? 'border-accent bg-accent/10' : 'border-border hover:bg-muted'}`}
              aria-pressed={model.path === file.path}
              disabled={model.discard.busy}
              onClick={() => model.choose({ turnId: model.selection.turnId, path: file.path })}
            >
              <span className="block wrap-anywhere font-mono">{file.path}</span>
              <span className="mt-1 block text-muted-foreground">{fileLabel(file)}</span>
            </button>
          </li>
        ))}
      </ul>
      {!model.changes.length && !model.status.isFetching && (
        <p className="text-xs text-muted-foreground">
          {model.selection.turnId ? '此轮没有可展示的文件净差异。' : '当前没有可展示的本地差异。'}
        </p>
      )}
      <ExcludedChanges model={model} />
    </>
  );
}
function ExcludedChanges({ model }: { model: ChangesPanelModel }) {
  const excluded = model.selection.turnId ? model.record?.excluded : model.status.data?.excluded;
  return excluded ? <ExcludedList excluded={excluded} /> : null;
}
function ChangeResult({ model }: { model: ChangesPanelModel }) {
  return (
    <>
      {model.discard.error && (
        <p role="alert" className="text-xs text-destructive-foreground">
          {model.discard.error}
        </p>
      )}
      {model.discard.notice && (
        <p role="status" className="text-xs leading-5">
          {model.discard.notice}
        </p>
      )}
      {model.discard.preview && (
        <DiscardConfirmation
          key={model.discard.preview.revision}
          preview={model.discard.preview}
          busy={model.discard.busy}
          cancel={model.discard.cancel}
          confirm={() => {
            void model.discard.discard();
          }}
        />
      )}
      {model.displayDiff && model.path && (
        <DiffView diff={model.displayDiff} path={model.path} source={model.source} onFeedback={model.feedback} />
      )}
    </>
  );
}
export default function ChangesPanel(input: ChangesPanelInput) {
  const model = useChangesPanel(input);
  return (
    <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-auto p-3" aria-label="工作区改动">
      <p className="text-xs leading-5 text-muted-foreground">
        本轮比较启动前和同步收尾后的本地快照，包含期间外部编辑的净差异。
      </p>
      <ChangeControls model={model} />
      <ChangeNotices model={model} dirty={input.dirty} />
      <ChangeFiles model={model} />
      <ChangeResult model={model} />
    </div>
  );
}
