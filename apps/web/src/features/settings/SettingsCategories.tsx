import { Tab, TabList, TabPanel, TabProvider } from '@ariakit/react';
import { useId, type ReactNode } from 'react';
import { Cpu, FolderSync, MessagesSquare, MonitorCheck } from 'lucide-react';

const categories = [
  { key: 'conversation', label: '对话与模型', Icon: MessagesSquare },
  { key: 'sync', label: '文件同步', Icon: FolderSync },
  { key: 'resources', label: '服务器资源', Icon: Cpu },
  { key: 'environment', label: '运行环境', Icon: MonitorCheck },
] as const;
export type SettingsCategory = (typeof categories)[number]['key'];

/** 分类仅切换可见内容，草稿和统一保存由父级持有。 */
export function SettingsCategories({
  category,
  select,
  children,
}: {
  category: SettingsCategory;
  select(category: SettingsCategory): void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <TabProvider
      selectedId={`${id}-${category}`}
      setSelectedId={(selected) => {
        const next = categories.find((item) => `${id}-${item.key}` === selected);
        if (next) select(next.key);
      }}
    >
      <TabList aria-label="设置分类" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
        {categories.map(({ key, label, Icon }) => (
          <Tab
            key={key}
            id={`${id}-${key}`}
            className="flex min-h-11 items-center justify-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground aria-selected:bg-card aria-selected:font-medium aria-selected:text-foreground aria-selected:shadow-sm focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            {label}
          </Tab>
        ))}
      </TabList>
      <TabPanel key={category} tabId={`${id}-${category}`} className="min-h-60 space-y-4 outline-none">
        {children}
      </TabPanel>
    </TabProvider>
  );
}
