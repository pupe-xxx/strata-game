// 移行前（素の JavaScript 版）の動作記録と、今のルールの動作が一致するかを確かめる。
// 記録は tests/golden/golden.json。乱数を固定した 200 試合の、毎ターンの盤面ハッシュ。
// ルールを意図して変えた時は、この記録を取り直す（変える前に、変わってよい理由を確かめること）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import { CpuAI } from '../src/game/cpu';
import * as logic from '../src/game/logic';
import { setRandom } from '../src/game/random';
import * as state from '../src/game/state';
import { runGame } from './golden/sim-core.mjs';

interface GoldenGame {
  seed: number;
  turnsPlayed: number;
  winner: string | null;
  score: { p1: number; p2: number };
  turns: string[];
}

const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url), 'utf8')) as { games: GoldenGame[] };
const api = { ...logic, ...state, CONFIG, getCpuActions: CpuAI.getCpuActions, setRandom };

describe('移行前の動作記録との照合', () => {
  it(`${golden.games.length} 試合すべてで、毎ターンの盤面が記録と一致する`, () => {
    const mismatches: string[] = [];
    for (const g of golden.games) {
      const r = runGame(api, g.seed);
      const at = r.turns.findIndex((h: string, i: number) => h !== g.turns[i]);
      if (at >= 0 || r.turns.length !== g.turns.length) mismatches.push(`seed ${g.seed}: ターン ${at} で食い違い`);
      else if (r.winner !== g.winner || r.score.p1 !== g.score.p1 || r.score.p2 !== g.score.p2)
        mismatches.push(`seed ${g.seed}: 勝敗か得点が食い違い`);
    }
    expect(mismatches).toEqual([]);
  }, 180_000);
});
