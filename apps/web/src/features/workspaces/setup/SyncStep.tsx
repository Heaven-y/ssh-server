import {
  SyncSettingsSchema,
  type WorkspaceInput,
  type WorkspaceSetupPreview,
  type SetupInventory,
} from '@ssh-server/shared';
import { SyncSettingsForm } from '../../sync/SyncSettingsForm';
import { buttonClass } from '../../../ui/styles';

const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(2)} MiB`;
function Inventory({ name, inventory }: { name: string; inventory: SetupInventory }) {
  return (
    <section className="rounded border border-border p-3">
      <h4 className="mb-2 text-sm font-medium">{name}</h4>
      <p className="text-xs leading-5">
        纳入：{inventory.included.files} 个文件，{bytes(inventory.included.bytes)}
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        排除：{inventory.excluded.files} 个文件，{bytes(inventory.excluded.bytes)}
      </p>
      {inventory.excluded.examples.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer py-2">排除示例（最多20项）</summary>
          <ul>
            {inventory.excluded.examples.map((file) => (
              <li key={file} className="py-1 font-mono wrap-anywhere">
                {file}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
export function SyncStep(props: {
  input: WorkspaceInput;
  change(patch: Partial<WorkspaceInput>): void;
  preview?: WorkspaceSetupPreview;
  busy: boolean;
  previewFiles(): void;
  dirty: boolean;
  setDirty(dirty: boolean): void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <SyncSettingsForm
        settings={SyncSettingsSchema.parse(props.input.sync ?? {})}
        busy={props.busy}
        defaultOpen
        saveLabel="应用同步规则"
        onDirtyChange={props.setDirty}
        save={(sync) => props.change({ sync })}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        预览只统计文件元数据，不传输正文。仅在点击后扫描；.git 目录始终跳过且不计入总量，超限或失败会明确提示未完成。
      </p>
      <button
        type="button"
        className={`${buttonClass('outline')} self-start`}
        disabled={props.busy || props.dirty}
        onClick={props.previewFiles}
      >
        {props.busy ? '正在统计…' : '预览同步范围'}
      </button>
      {props.preview && (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            预览时间：{new Date(props.preview.sampledAt).toLocaleString()}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Inventory name="本地副本" inventory={props.preview.local} />
            <Inventory name="服务器目录" inventory={props.preview.remote} />
          </div>
        </>
      )}
    </div>
  );
}
