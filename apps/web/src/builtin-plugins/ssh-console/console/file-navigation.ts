export type DirectoryHistory = { entries: string[]; index: number };
export type NavigationKind = 'push' | 'refresh' | number;

/** 只提交服务器返回的规范化路径；失败请求不调用此函数。 */
export function commitDirectory(history: DirectoryHistory, path: string, kind: NavigationKind): DirectoryHistory {
  if (kind === 'refresh') return history;
  if (typeof kind === 'number') {
    const entries = [...history.entries];
    entries[kind] = path;
    return { entries, index: kind };
  }
  if (history.entries[history.index] === path) return history;
  const entries = [...history.entries.slice(0, history.index + 1), path].slice(-50);
  return { entries, index: entries.length - 1 };
}
export function directoryCrumbs(path: string) {
  if (!path.startsWith('/')) return [{ name: path, path }];
  let current = '';
  return [
    { name: '/', path: '/' },
    ...path
      .split('/')
      .filter(Boolean)
      .map((name) => {
        current += `/${name}`;
        return { name, path: current };
      }),
  ];
}
