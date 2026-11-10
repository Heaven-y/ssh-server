import { Combobox, ComboboxItem, ComboboxList, useComboboxStore, type ComboboxStore } from '@ariakit/react/combobox';
import { Check, Search } from 'lucide-react';
import { useState } from 'react';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass, inputClass } from '../../ui/styles';
import { findModel } from '../../cli/shared/model-identity';
import { ModelCandidateLabel } from './ModelCandidateLabel';
import { matchingModels, type ModelCandidate } from './model-candidates';

type Props = { models: ModelCandidate[]; current: string; disabled: boolean; choose(id: string): void; close(): void };
const PAGE_SIZE = 50;

function Results({ store, models, current, disabled, choose }: Omit<Props, 'close'> & { store: ComboboxStore }) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const selected = findModel(models, current)?.id;
  return (
    <>
      <ComboboxList
        store={store}
        alwaysVisible
        aria-label="全部模型"
        className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-border p-1"
      >
        {models.slice(0, limit).map((model) => (
          <ComboboxItem
            key={model.id}
            value={model.id}
            disabled={disabled}
            setValueOnClick={false}
            selectValueOnClick={false}
            aria-selected={selected === model.id}
            onClick={() => choose(model.id)}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-none data-active-item:bg-muted data-active-item:ring-1 data-active-item:ring-border-strong aria-disabled:opacity-45"
          >
            <Check aria-hidden className={`size-3.5 shrink-0 ${selected === model.id ? '' : 'invisible'}`} />
            <span className="min-w-0 flex-1">
              <ModelCandidateLabel model={model} />
            </span>
          </ComboboxItem>
        ))}
      </ComboboxList>
      {!models.length && (
        <p role="status" className="py-4 text-center text-sm text-muted-foreground">
          没有匹配的模型
        </p>
      )}
      {models.length > limit && (
        <button
          type="button"
          className={`${buttonClass('ghost')} mt-2 w-full`}
          onClick={() => setLimit((value) => value + PAGE_SIZE)}
        >
          显示更多模型
        </button>
      )}
    </>
  );
}

/** 输入与结果使用标准 combobox；完整目录只在本机检索，打开搜索不发发现请求。 */
export function ModelSearchDialog({ models, current, disabled, choose, close }: Props) {
  const [phrase, setPhrase] = useState('');
  const store = useComboboxStore({
    inputValue: phrase,
    setInputValue: setPhrase,
    open: true,
    includesBaseElement: false,
    focusLoop: true,
  });
  const matches = matchingModels(models, phrase);
  return (
    <DetailDialog title="选择模型" onClose={close}>
      <div className="relative">
        <Search aria-hidden className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Combobox
          store={store}
          autoFocus
          autoSelect="always"
          aria-label="搜索模型"
          placeholder="搜索名称或型号"
          className={`${inputClass} pl-9`}
        />
      </div>
      <Results key={phrase} store={store} models={matches} current={current} disabled={disabled} choose={choose} />
    </DetailDialog>
  );
}
