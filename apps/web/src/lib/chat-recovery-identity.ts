type Identity = { token: string; create: boolean };
export type IdentityLease = { identity: Identity; release(): void };
const STORAGE_KEY = 'agentdeck.chatRecovery';

function savedIdentity(): Identity {
  try {
    const token = sessionStorage.getItem(STORAGE_KEY);
    if (token && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token)) return { token, create: false };
  } catch {
    /* 禁用存储时仍支持本页断线续收。 */
  }
  return newIdentity();
}
function newIdentity(): Identity {
  const token = crypto.randomUUID();
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* 不将恢复内容写入其他存储。 */
  }
  return { token, create: true };
}
function lockIdentity(token: string): Promise<(() => void) | undefined> {
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(`agentdeck.chatRecovery.${token}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(undefined);
          return;
        }
        return new Promise<void>((release) => resolve(release));
      })
      .catch(reject);
  });
}

/** 文档持锁直到销毁；复制页签即使继承 sessionStorage，也会得到新的随机身份。 */
export async function claimRecoveryIdentity(fresh: boolean): Promise<IdentityLease> {
  let identity = fresh ? newIdentity() : savedIdentity();
  if (typeof navigator === 'undefined' || !navigator.locks) return { identity, release: () => undefined };
  try {
    let release = await lockIdentity(identity.token);
    if (!release) {
      identity = newIdentity();
      release = await lockIdentity(identity.token);
    }
    return { identity, release: release ?? (() => undefined) };
  } catch {
    // 锁服务不可用时不使用可能由复制页签继承的凭据；当前页仍能断线续收。
    return { identity: newIdentity(), release: () => undefined };
  }
}
