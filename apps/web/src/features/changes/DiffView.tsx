import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { VersionDiff } from '@ssh-server/shared';
import type { FeedbackSource, LineFeedbackInput } from './types';

const DiffRenderer = lazy(() => import('./DiffRenderer'));
export type DiffViewProps = {
  diff: VersionDiff;
  path?: string;
  source?: FeedbackSource;
  onFeedback?(input: LineFeedbackInput): boolean;
};

export function RawDiff({ text, message }: { text: string; message: string }) {
  return (
    <div className="space-y-2">
      <p role="status" className="text-xs leading-5 text-warning">
        {message}
      </p>
      <pre
        tabIndex={0}
        aria-label="文件差异原文本"
        className="max-h-96 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-6 whitespace-pre"
      >
        {text || '没有文本差异。二进制或文件模式变化请核对文件列表。'}
      </pre>
    </div>
  );
}

class DiffBoundary extends Component<{ children: ReactNode; text: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <RawDiff text={this.props.text} message="差异组件暂不可用，保留原文本；此视图不提供行反馈。" />
    ) : (
      this.props.children
    );
  }
}

/** 大型差异组件仅在差异可见时加载；失败仍保留服务端有界原文本。 */
export function DiffView(props: DiffViewProps) {
  return (
    <DiffBoundary key={props.diff.text} text={props.diff.text}>
      <Suspense
        fallback={
          <p role="status" className="text-xs text-muted-foreground">
            正在显示差异…
          </p>
        }
      >
        <DiffRenderer {...props} />
      </Suspense>
    </DiffBoundary>
  );
}
