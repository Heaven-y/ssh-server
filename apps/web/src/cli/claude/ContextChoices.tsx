import { MenuSeparator, MenuGroup } from '@ariakit/react';
import type { AgentModel } from '@agentdeck/shared/conversation';
import { MenuChoice as Choice } from '../../ui/MenuChoice';
import { claudeContextModels } from './context-models';
export function ClaudeContextChoices({
  disabled,
  model,
  models,
  choose,
}: {
  disabled: boolean;
  model: string;
  models: AgentModel[];
  choose(id: string): void;
}) {
  const choices = claudeContextModels(model, models);
  if (!choices) return null;
  return (
    <>
      <MenuSeparator className="my-1 border-t border-border" />
      <MenuGroup aria-label="Claude 上下文窗口">
        <p className="px-3 py-2 text-xs text-muted-foreground">上下文窗口</p>
        <div className="grid grid-cols-2 gap-1">
          <Choice checked={!choices.selected} disabled={disabled} choose={() => choose(choices.standard)}>
            默认窗口
          </Choice>
          <Choice checked={choices.selected} disabled={disabled} choose={() => choose(choices.extended)}>
            1M
          </Choice>
        </div>
      </MenuGroup>
    </>
  );
}
