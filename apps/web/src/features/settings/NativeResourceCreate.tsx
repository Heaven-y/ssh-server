import { useEffect, useId, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import type { NativeResourceRoot, NativeResourceSaved } from '@agentdeck/shared';
import { api, type NativeResourceContext } from '../../lib/api';
import { CodeEditor } from '../../ui/CodeEditor';
import { buttonClass, inputClass } from '../../ui/styles';
import { SettingsDetailDialog } from './SettingsDetailDialog';
import { confirmNativeDiscard, nativeSettingsError } from './native-resource-labels';

type CreateProps = {
  context: NativeResourceContext;
  root: NativeResourceRoot;
  onBack(): void;
  onClose(): void;
};
function invalidResourceName(name: string, isSkill: boolean) {
  if (!isSkill) return !name.trim() || /[/\\]/.test(name);
  return name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}
function useNativeResourceCreate({ context, root }: Pick<CreateProps, 'context' | 'root'>) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<NativeResourceSaved>();
  const pending = useRef<AbortController | undefined>(undefined);
  const lock = useRef(false);
  useEffect(() => () => pending.current?.abort(), []);
  const isSkill = root.kind === 'skills';
  const dirty = !saved && !!(name || description || content);
  const invalidName = invalidResourceName(name, isSkill);
  const invalid = invalidName || (isSkill && !description.trim()) || !content.trim();
  const leave = (action: () => void) => {
    if (lock.current || !confirmNativeDiscard(dirty)) return;
    pending.current?.abort();
    setName('');
    setDescription('');
    setContent('');
    action();
  };
  const save = async () => {
    if (lock.current || invalid || !root.editable) return;
    lock.current = true;
    setSaving(true);
    setError('');
    const controller = new AbortController();
    pending.current = controller;
    const text = isSkill
      ? `---\nname: ${JSON.stringify(name.trim())}\ndescription: ${JSON.stringify(description.trim())}\n---\n\n${content}`
      : content;
    try {
      const result = await api.createNativeResource(
        context,
        { rootId: root.id, name: name.trim(), content: text },
        controller.signal,
      );
      if (!controller.signal.aborted) setSaved(result);
    } catch (reason) {
      if (!controller.signal.aborted) setError(nativeSettingsError(reason));
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  };
  return {
    name,
    description,
    content,
    error,
    saving,
    saved,
    dirty,
    invalid,
    invalidName,
    isSkill,
    leave,
    save,
    setName,
    setDescription,
    setContent,
  };
}
type CreateState = ReturnType<typeof useNativeResourceCreate>;

export default function NativeResourceCreate({ context, root, onBack, onClose }: CreateProps) {
  const state = useNativeResourceCreate({ context, root });
  return (
    <SettingsDetailDialog
      title={`新建${state.isSkill ? ' Skill' : '规则'} · ${root.label}`}
      backLabel="返回资源目录"
      busy={state.saving}
      onBack={() => state.leave(onBack)}
      onClose={() => state.leave(onClose)}
      footer={<CreateFooter state={state} editable={root.editable} />}
    >
      <p className="break-all font-mono text-xs text-muted-foreground">{root.displayPath}</p>
      <CreateFields state={state} />
      {state.error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="break-all text-sm text-muted-foreground">
          已创建：{state.saved.resource.displayPath}
        </p>
      )}
    </SettingsDetailDialog>
  );
}

function CreateFooter({ state, editable }: { state: CreateState; editable: boolean }) {
  return (
    <>
      <p className="text-xs text-muted-foreground">{state.dirty ? '有未保存修改' : '只在所选原生目录创建文件'}</p>
      <button
        type="button"
        className={buttonClass('primary')}
        disabled={state.saving || !!state.saved || state.invalid || !editable}
        onClick={() => void state.save()}
      >
        <Save aria-hidden className="size-4" />
        {state.saving ? '正在创建…' : '创建文件'}
      </button>
    </>
  );
}

function CreateFields({ state }: { state: CreateState }) {
  const { description, content, saving, saved, isSkill, setDescription, setContent } = state;
  const disabled = saving || !!saved;
  return (
    <>
      <ResourceName state={state} disabled={disabled} />
      {isSkill && (
        <label className="block space-y-2 text-sm">
          <span>Skill 用途</span>
          <input
            className={inputClass}
            value={description}
            maxLength={1000}
            disabled={disabled}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      )}
      <div className="min-w-0 overflow-hidden rounded-md border border-border-strong">
        <CodeEditor
          value={content}
          format="markdown"
          disabled={disabled}
          label={isSkill ? 'Skill 使用说明' : '规则内容'}
          onChange={setContent}
        />
      </div>
    </>
  );
}

function ResourceName({ state, disabled }: { state: CreateState; disabled: boolean }) {
  const id = useId();
  const { isSkill, name, setName, invalidName } = state;
  return (
    <>
      <label className="block space-y-2 text-sm">
        <span>{isSkill ? 'Skill 名称' : '规则文件名'}</span>
        <input
          className={inputClass}
          value={name}
          maxLength={isSkill ? 64 : 100}
          disabled={disabled}
          aria-invalid={name.length > 0 && invalidName}
          aria-describedby={id}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <p id={id} className="text-xs text-muted-foreground">
        {isSkill
          ? '使用 1–64 位小写字母、数字，可用单个连字符分隔；不以连字符开头或结尾。创建同名目录及 SKILL.md。'
          : '填写一个文件名，不包含目录。文件名自动补齐 .md。'}
      </p>
    </>
  );
}
