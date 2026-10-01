// ルール側の乱数の差し替え口。
// 通常は Math.random。テストと画面なしの対戦では、種を固定した乱数に差し替える。

let source: () => number = Math.random;

export function random(): number {
  return source();
}

export function setRandom(fn: () => number): void {
  source = fn;
}
