type NamedEntry = { name: string } & ({ type: string } | { kind: string });
const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const rank = (entry: NamedEntry) => {
  const type = 'type' in entry ? entry.type : entry.kind;
  return type === 'directory' ? 0 : type === 'file' ? 1 : type === 'link' ? 2 : 3;
};

/** 同一规则用于本地代码、创建向导和服务器目录；大小写同序时用原文打破平局。 */
export function compareDirectoryEntries(left: NamedEntry, right: NamedEntry): number {
  return (
    rank(left) - rank(right) ||
    names.compare(left.name, right.name) ||
    (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  );
}

/** 只为当前一层目录建立有界元数据快照，不递归、不读取文件正文。 */
export function createDirectoryBudget() {
  let count = 0;
  let bytes = 0;
  return (value: unknown) => {
    count++;
    bytes += Buffer.byteLength(JSON.stringify(value), 'utf8');
    return count <= 10_000 && bytes <= 4 * 1024 * 1024;
  };
}
