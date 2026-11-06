// 仅内存的 SSH 密码：绑定解析后的目标，认证周期结束后移除引用。
type Credential = { identity: string; password: string };

export function createCredentialVault() {
  const entries = new Map<string, Credential>();
  const revisions = new Map<string, number>();
  const revision = (alias: string) => revisions.get(alias) ?? 0;
  const clear = (alias: string) => {
    entries.delete(alias);
    revisions.set(alias, revision(alias) + 1);
  };
  return {
    set(alias: string, identity: string, password: string) {
      clear(alias);
      entries.set(alias, { identity, password });
    },
    get(alias: string, identity: string): string | undefined {
      const entry = entries.get(alias);
      if (entry && entry.identity !== identity) {
        clear(alias);
        return undefined;
      }
      return entry?.password;
    },
    revision,
    clear,
    clearAll() {
      for (const alias of entries.keys()) clear(alias);
    },
  };
}
