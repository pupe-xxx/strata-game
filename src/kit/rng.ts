// 種（seed）を固定できる乱数。
// ルール側では Math.random を使わず、必ずこれを受け取って使う。
// 同じ種なら同じ試合になるので、テストと不具合の再現ができる。

export interface Rng {
  /** 0 以上 1 未満 */
  next(): number;
  /** 0 以上 n 未満の整数 */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number = Date.now()): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick: 空の配列からは選べない');
      return items[int(items.length)] as T;
    },
  };
}
