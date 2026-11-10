import { create } from 'zustand';
import type { SpotlightSettings } from '@agentdeck/shared/settings';

/** 草稿预览只留内存；关闭设置即恢复服务端保存值。 */
export const useSpotlightPreview = create<{ value?: SpotlightSettings; set(value?: SpotlightSettings): void }>(
  (set) => ({
    set: (value) => set({ value }),
  }),
);
