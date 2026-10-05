import { useId, useMemo, useState } from 'react';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { useUiPreferences } from '../../ui/ui-preferences';
import { buttonClass, inputClass } from '../../ui/styles';
import { RawDiff, type DiffViewProps } from './DiffView';

type Anchor = { side: 'old' | 'new'; line: number };
function validAnchor(file: FileDiffMetadata, anchor: Anchor): boolean {
  if (!Number.isSafeInteger(anchor.line) || anchor.line < 1) return false;
  return file.hunks.some((hunk) => {
    const start = anchor.side === 'old' ? hunk.deletionStart : hunk.additionStart;
    const count = anchor.side === 'old' ? hunk.deletionCount : hunk.additionCount;
    return anchor.line >= start && anchor.line < start + count;
  });
}

function FeedbackForm({
  file,
  anchor,
  setAnchor,
  submit,
}: {
  file: FileDiffMetadata;
  anchor: Anchor;
  setAnchor(anchor: Anchor): void;
  submit(comment: string): boolean;
}) {
  const id = useId();
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState('');
  const valid = validAnchor(file, anchor);
  return (
    <form
      className="space-y-2 rounded-lg border border-border p-3"
      aria-label="添加行内反馈"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && submit(comment)) {
          setComment('');
          setNotice('已加入当前会话待发送区');
        } else setNotice('未加入反馈，请核对行号、评论和待发送数量。');
      }}
    >
      <p className="text-xs leading-5 text-muted-foreground">点击差异行，或通过侧别与行号选择真实显示的行。</p>
      <div className="grid grid-cols-2 gap-2">
        <label htmlFor={`${id}-side`} className="text-xs">
          侧别
          <select
            id={`${id}-side`}
            aria-label="侧别"
            className={`${inputClass} mt-1`}
            value={anchor.side}
            onChange={(event) => setAnchor({ ...anchor, side: event.target.value as Anchor['side'] })}
          >
            <option value="old">旧侧</option>
            <option value="new">新侧</option>
          </select>
        </label>
        <label htmlFor={`${id}-line`} className="text-xs">
          行号
          <input
            id={`${id}-line`}
            className={`${inputClass} mt-1`}
            type="number"
            min={1}
            step={1}
            value={anchor.line || ''}
            aria-invalid={!valid}
            onChange={(event) => setAnchor({ ...anchor, line: Number(event.target.value) })}
          />
        </label>
      </div>
      {!valid && <p className="text-xs text-warning">该侧行号不在当前差异块中。</p>}
      <label htmlFor={`${id}-comment`} className="block text-xs">
        行反馈
        <textarea
          id={`${id}-comment`}
          className={`${inputClass} mt-1 min-h-20 resize-y`}
          maxLength={3000}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
      <button type="submit" className={buttonClass('outline')} disabled={!valid || !comment.trim()}>
        加入待发送反馈
      </button>
      {notice && (
        <p role="status" className="text-xs leading-5">
          {notice}
        </p>
      )}
    </form>
  );
}

function FileSurface({ file, props }: { file: FileDiffMetadata; props: DiffViewProps }) {
  const theme = useUiPreferences((state) => state.theme);
  const [anchor, setAnchor] = useState<Anchor>({ side: 'new', line: file.hunks[0]?.additionStart ?? 1 });
  const feedback = props.source && props.path && props.onFeedback && !props.diff.truncated && file.hunks.length > 0;
  const submit = (comment: string) =>
    props.onFeedback?.({ path: props.path!, source: props.source!, ...anchor, comment }) === true;
  return (
    <div className="min-w-0 space-y-3">
      <FileDiff
        fileDiff={file}
        options={{
          theme: { dark: 'github-dark-high-contrast', light: 'github-light-high-contrast' },
          themeType: theme,
          diffStyle: 'unified',
          overflow: 'wrap',
          hunkSeparators: 'line-info',
          onLineClick: feedback
            ? ({ lineNumber, annotationSide }) =>
                setAnchor({ line: lineNumber, side: annotationSide === 'deletions' ? 'old' : 'new' })
            : undefined,
          onLineNumberClick: feedback
            ? ({ lineNumber, annotationSide }) =>
                setAnchor({ line: lineNumber, side: annotationSide === 'deletions' ? 'old' : 'new' })
            : undefined,
        }}
        className="overflow-hidden rounded-lg border border-border text-xs"
      />
      {feedback && <FeedbackForm file={file} anchor={anchor} setAnchor={setAnchor} submit={submit} />}
    </div>
  );
}

export default function DiffRenderer(props: DiffViewProps) {
  const parsed = useMemo(() => {
    try {
      return { files: parsePatchFiles(props.diff.text, undefined, true).flatMap((patch) => patch.files) };
    } catch {
      return { files: [] as FileDiffMetadata[], error: true };
    }
  }, [props.diff.text]);
  if (parsed.error || !parsed.files.length)
    return (
      <RawDiff
        text={props.diff.text}
        message={
          parsed.error
            ? '差异解析失败，保留原文本；不提供行反馈。'
            : '没有可评论的文本差异；二进制或模式变化以文件列表为准。'
        }
      />
    );
  return (
    <div className="space-y-3">
      {props.diff.truncated && (
        <p role="status" className="text-xs text-warning">
          差异已截断，请按单文件缩小范围；当前不提供行反馈。
        </p>
      )}
      {parsed.files.map((file, index) => (
        <FileSurface key={`${file.name}-${index}`} file={file} props={props} />
      ))}
    </div>
  );
}
