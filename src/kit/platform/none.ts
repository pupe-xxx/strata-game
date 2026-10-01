import type { Platform } from './types';

// 広告なし（GitHub Pages・手元での開発用）。何もしない
export const nonePlatform: Platform = {
  name: 'none',
  async init() {},
  loadingFinished() {},
  gameplayStart() {},
  gameplayStop() {},
  async commercialBreak() {},
  async rewardedBreak() {
    return false;
  },
};
