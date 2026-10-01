import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import { CpuAI } from '../src/game/cpu';
import { generateEchoPoints } from '../src/game/logic';
import { setRandom } from '../src/game/random';
import { playCpuGame, playMany } from '../src/game/sim';
import { allPieces, createInitialState } from '../src/game/state';
import { createRng } from '../src/kit/rng';

describe('画面なしの CPU 同士の対戦', () => {
  it('同じ種なら同じ試合になる', () => {
    expect(playCpuGame(7)).toEqual(playCpuGame(7));
  });

  it('どの試合も決着し、ターン数は上限+1 以内', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = playCpuGame(seed);
      expect(['p1', 'p2', 'draw']).toContain(r.winner);
      expect(r.turns).toBeLessThanOrEqual(CONFIG.MAX_TURNS + 1);
    }
  });

  it('勝敗の合計が試合数と合う', () => {
    const t = playMany(10, 100);
    expect(t.p1 + t.p2 + t.draw + t.unfinished).toBe(10);
  });
});

describe('CPU はどちらの側でも指せる', () => {
  it('先手として指す時は、先手の駒だけを動かす', () => {
    setRandom(createRng(3).next);
    try {
      const state = createInitialState();
      generateEchoPoints(state);
      const mine = new Set([...allPieces(state, 'p1').map(p => p.piece.id), ...state.p1Hand.map(p => p.id)]);
      const actions = CpuAI.getCpuActions(state, 'p1');
      expect(actions.length).toBeGreaterThan(0);
      for (const a of actions) expect(mine.has(a.pieceId as string)).toBe(true);
    } finally {
      setRandom(Math.random);
    }
  });
});
