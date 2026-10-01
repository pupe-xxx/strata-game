import { nonePlatform } from './none';
import type { Platform } from './types';

export type { Platform } from './types';

/**
 * ビルド時の VITE_PLATFORM で、どのサイト向けかを選ぶ。指定が無ければ広告なし。
 *
 * サイトを足す時：
 *   1. このフォルダに poki.ts などを作り、Platform の形で SDK を包む
 *   2. 下の switch に1行足す（import() にすると、他のサイト向けのビルドに SDK が混ざらない）
 *   3. .env.poki に VITE_PLATFORM=poki と書き、`vite build --mode poki` でビルドする
 */
export async function loadPlatform(): Promise<Platform> {
  switch (import.meta.env.VITE_PLATFORM) {
    // case 'poki': return (await import('./poki')).pokiPlatform;
    default:
      return nonePlatform;
  }
}
