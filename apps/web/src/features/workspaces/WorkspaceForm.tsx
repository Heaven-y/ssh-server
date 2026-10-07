import type { Workspace } from '@ssh-server/shared';
import { useEffect, useRef } from 'react';
import { buttonClass } from '../../ui/styles';
import { LocalStep } from './setup/LocalStep';
import { ServerStep } from './setup/ServerStep';
import { RemoteStep } from './setup/RemoteStep';
import { SyncStep } from './setup/SyncStep';
import { ConfirmStep } from './setup/ConfirmStep';
import { SETUP_STEPS, useWorkspaceSetup } from './setup/use-workspace-setup';
import { SetupError } from './setup/SetupError';
import { SettingsLoadError } from '../settings/SettingsLoadError';

type Setup = ReturnType<typeof useWorkspaceSetup>;
function Step({ setup }: { setup: Setup }) {
  const { input, change } = setup;
  switch (setup.step) {
    case 0:
      return <LocalStep input={input} change={change} />;
    case 1:
      return <ServerStep input={input} change={change} />;
    case 2:
      return <RemoteStep key={input.sshHost} input={input} change={change} />;
    case 3:
      return (
        <SyncStep
          input={input}
          change={change}
          preview={setup.preview}
          busy={setup.busy || !setup.defaultsReady}
          previewFiles={() => void setup.previewFiles()}
          dirty={setup.syncDirty}
          setDirty={setup.setSyncDirty}
        />
      );
    default:
      return (
        <ConfirmStep
          input={input}
          ticket={setup.ticket}
          busy={setup.busy}
          creating={setup.creating}
          confirmed={setup.confirmed}
          setConfirmed={setup.setConfirmed}
          verify={() => void setup.verify()}
        />
      );
  }
}
function Created({ setup }: { setup: Setup }) {
  if (!setup.result) return null;
  const { workspace, sync } = setup.result;
  const ready = sync.phase === 'ready' && !sync.reason;
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-medium">工作区“{workspace.name}”已创建</h3>
      <p role="status" className={`text-sm leading-6 ${ready ? 'text-success' : 'text-warning'}`}>
        {ready ? '首次同步已完成' : (sync.message ?? '首次同步需要进一步处理，请打开同步详情')}
      </p>
      {!ready && (
        <p className="text-xs leading-5 text-muted-foreground">工作区已保留。可以处理冲突或恢复同步后继续使用。</p>
      )}
      <button type="button" className={`${buttonClass('primary')} self-end`} onClick={setup.finish}>
        打开工作区
      </button>
    </div>
  );
}
/** 五步配置只在最终验证后保存；创建与首次同步结果分别呈现。 */
export function WorkspaceForm(props: {
  onCreated(workspace: Workspace): void;
  onCancel(): void;
  onBusyChange?(busy: boolean): void;
}) {
  const setup = useWorkspaceSetup(props);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [setup.step]);
  if (setup.result) return <Created setup={setup} />;
  return (
    <section aria-label="新建工作区" className="flex min-w-0 flex-col gap-5">
      <ol aria-label="创建步骤" className="grid grid-cols-5 gap-2 text-center text-xs">
        {SETUP_STEPS.map((step, index) => (
          <li
            key={step}
            aria-current={index === setup.step ? 'step' : undefined}
            className={`min-w-0 rounded border px-1 py-2 leading-5 ${index === setup.step ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted-foreground'}`}
          >
            <span className="block font-mono">{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <div role="status" className="text-xs text-muted-foreground">
        {setup.defaultsReady ? '已读取产品同步默认值；本次草稿独立保存。' : '正在读取产品同步默认值…'}
        <SettingsLoadError error={setup.defaultsError} retry={setup.retryDefaults} message="同步默认值读取失败" />
      </div>
      <h3
        ref={heading}
        tabIndex={-1}
        className="text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent"
      >
        {SETUP_STEPS[setup.step]}
      </h3>
      <fieldset disabled={setup.creating} className="min-w-0">
        <legend className="sr-only">当前步骤配置</legend>
        <Step setup={setup} />
      </fieldset>
      <SetupError message={setup.message} />
      {setup.creating && (
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          正在创建工作区并初始化同步，请等待首次同步结果…
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <button type="button" className={buttonClass('ghost')} disabled={setup.creating} onClick={setup.cancel}>
          取消
        </button>
        {setup.step > 0 && (
          <button
            type="button"
            className={buttonClass('outline')}
            disabled={setup.creating}
            onClick={() => setup.navigate(setup.step - 1)}
          >
            上一步
          </button>
        )}
        {setup.step < 4 ? (
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={setup.creating}
            onClick={() => setup.navigate(setup.step + 1)}
          >
            下一步
          </button>
        ) : (
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={setup.creating || setup.busy || !setup.ticket || !setup.confirmed}
            onClick={setup.submit}
          >
            创建并初始化同步
          </button>
        )}
      </div>
    </section>
  );
}
