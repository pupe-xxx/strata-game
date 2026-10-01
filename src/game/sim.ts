// ===== STRATA — 画面なしの CPU 同士の対戦 =====
import { createRng } from '../kit/rng';
import { CpuAI } from './cpu';
import { generateEchoPoints } from './logic';
import { setRandom } from './random';
import { createInitialState } from './state';
import { playTurn } from './turn';
import type { Action, GameState, Owner } from './types';

export interface GameResult {
  seed: number;
  winner: NonNullable<GameState['winner']> | 'unfinished';
  turns: number;
  score: Record<Owner, number>;
}

function cpuActions(state: GameState, owner: Owner): Action[] {
  return CpuAI.getCpuActions(state, owner).map(a => ({ ...a, owner }) as Action);
}

/**
 * CPU 同士を1試合対戦させる。同じ種なら同じ試合になる。
 * ルール側の乱数を種で固定するので、終わったら Math.random に戻す。
 */
export function playCpuGame(seed: number, maxTurns = 60): GameResult {
  setRandom(createRng(seed).next);
  try {
    const state = createInitialState();
    generateEchoPoints(state);
    let turns = 0;
    while (state.phase !== 'GAME_OVER' && turns < maxTurns) {
      playTurn(state, cpuActions(state, 'p1'), cpuActions(state, 'p2'));
      turns++;
    }
    return { seed, winner: state.winner ?? 'unfinished', turns, score: { ...state.occScore } };
  } finally {
    setRandom(Math.random);
  }
}

export interface Tally {
  games: number;
  p1: number;
  p2: number;
  draw: number;
  unfinished: number;
  averageTurns: number;
  averageScore: Record<Owner, number>;
}

export function playMany(games: number, firstSeed = 1): Tally {
  const tally: Tally = { games, p1: 0, p2: 0, draw: 0, unfinished: 0, averageTurns: 0, averageScore: { p1: 0, p2: 0 } };
  for (let i = 0; i < games; i++) {
    const r = playCpuGame(firstSeed + i);
    tally[r.winner]++;
    tally.averageTurns += r.turns / games;
    tally.averageScore.p1 += r.score.p1 / games;
    tally.averageScore.p2 += r.score.p2 / games;
  }
  return tally;
}
