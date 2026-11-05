import { Component, type ReactNode } from 'react';
import { buttonClass } from '../../ui/styles';

/** 插件页面失败只关闭其显示，项目导航和对话状态仍由外壳保留。 */
export class PluginErrorBoundary extends Component<{ children: ReactNode; close(): void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="space-y-3 p-5 text-sm">
        <p>插件页面发生错误，可以关闭后重新打开。</p>
        <button type="button" className={buttonClass('outline')} onClick={this.props.close}>
          返回对话
        </button>
      </div>
    );
  }
}
