import type { NativeConfigAgent, NativeConfigDocument } from '@ssh-server/shared';
import { FilePlus2 } from 'lucide-react';
import { buttonClass } from '../../ui/styles';
import { nativeConfigTemplate } from './native-config-templates';

export function NativeConfigHelp({
  agent,
  document,
  content,
  disabled,
  onInsert,
}: {
  agent: NativeConfigAgent;
  document?: NativeConfigDocument;
  content: string;
  disabled: boolean;
  onInsert(content: string): void;
}) {
  const template = nativeConfigTemplate(agent);
  return (
    <div className="space-y-3 text-sm leading-6">
      {document?.content.trim() === '' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="min-w-0 flex-1 basis-72 text-muted-foreground">
            可沿用原生登录或环境变量。模板只填入草稿，保存后写入本机。
          </p>
          <button
            type="button"
            className={buttonClass('outline')}
            disabled={disabled || content.trim().length > 0}
            onClick={() => onInsert(template.content)}
          >
            <FilePlus2 aria-hidden className="size-4" />
            插入最小模板
          </button>
        </div>
      )}
      <details className="rounded-lg border border-border px-3">
        <summary className="min-h-11 cursor-pointer py-2.5 font-medium focus-visible:outline-2 focus-visible:outline-accent">
          查看填写说明
        </summary>
        <div role="region" aria-label="填写说明" className="space-y-3 pb-3 text-muted-foreground">
          <ul className="list-disc space-y-2 pl-5">
            {template.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p>原生登录请在本机工具中完成。环境变量可通过启动本机服务的环境提供；Claude 也支持 env 配置对象。</p>
          <p>
            {agent === 'claude'
              ? '第三方服务需支持 Claude Code，并按服务商要求配置认证。'
              : '第三方服务按 Codex 配置格式填写服务商、模型 ID 与认证。'}
          </p>
          <a
            href={
              agent === 'claude'
                ? 'https://code.claude.com/docs/en/settings'
                : 'https://developers.openai.com/codex/config-reference/'
            }
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center text-accent underline underline-offset-4"
          >
            {agent === 'claude' ? 'Claude Code 官方配置说明' : 'Codex 官方配置说明'}
          </a>
        </div>
      </details>
    </div>
  );
}
