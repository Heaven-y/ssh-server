// 桌面壳的启动编排：只决定「加载哪个地址」「是否单实例」「关窗如何退出」，
// 不碰 Electron API，能在没有显示器的环境里直接单测。

/** 决定窗口加载哪个地址：开发期渲染器地址优先，缺省加载主进程拉起的本机服务。 */
export function resolveWindowUrl(serverUrl: string, rendererUrl?: string): string {
  const renderer = rendererUrl?.trim();
  return renderer ? renderer : serverUrl;
}

export type SingleInstanceDeps = {
  requestLock: () => boolean;
  quit: () => void;
};

/**
 * 单实例：拿不到锁说明已有实例在跑，本次启动立即退出；
 * 已有窗口由第一个实例的 second-instance 事件拉到前面。
 */
export function acquireSingleInstance(deps: SingleInstanceDeps): boolean {
  if (deps.requestLock()) return true;
  deps.quit();
  return false;
}

export type ShutdownDeps = {
  close: () => Promise<void>;
  quit: () => void;
};

export type Shutdown = {
  /** 关窗或退出前调用：后端只释放一次，释放后再退出应用 */
  exitAfterClose: () => Promise<void>;
  /** before-quit 用：后端尚未释放时返回 true，调用方应 preventDefault 并等 exitAfterClose 完成 */
  preventQuitUntilClosed: () => boolean;
  readonly closed: boolean;
};

/** 关窗即退出：先释放后端（只做一次），再退出；释放失败也照样退出，不把窗口留在后台。 */
export function createShutdown(deps: ShutdownDeps): Shutdown {
  let pending: Promise<void> | undefined;
  let closed = false;
  const closeOnce = (): Promise<void> => {
    pending ??= deps.close().then(
      () => {
        closed = true;
      },
      () => {
        closed = true;
      },
    );
    return pending;
  };
  return {
    exitAfterClose: async () => {
      await closeOnce();
      deps.quit();
    },
    preventQuitUntilClosed: () => !closed,
    get closed() {
      return closed;
    },
  };
}
