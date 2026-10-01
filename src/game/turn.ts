// ===== STRATA — 1ターンの進め方 =====
// 両者の行動を受け取って1ターン進める。画面（main.ts）と、画面なしの対戦（sim.ts）の両方がここを使う。
import { CONFIG } from './config';
import { resolvePairActions, resolvePostTurn, resolvePreamble } from './logic';
import { tickReviveTimers } from './state';
import { LAYERS, ofType, type Action, type GameState, type Owner, type ReservedMoveAction } from './types';

/**
 * owner の駒のうち、予約移動が入っているものを「予約移動の実行」として並べる。
 * このターンに予約したばかりの駒（actions に RESERVE_SET がある駒）は、次のターンから動く。
 */
export function collectReservedMoves(state: GameState, owner: Owner, actions: readonly Action[]): ReservedMoveAction[] {
  const newReserveIds = new Set(ofType(actions, 'RESERVE_SET').map(a => a.pieceId));
  const out: ReservedMoveAction[] = [];
  for (const layer of LAYERS) {
    for (let r = 0; r < CONFIG.BOARD_SIZE; r++) {
      for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
        const p = state[layer][r][c].piece;
        if (p && p.owner === owner && p.reservedMove && !newReserveIds.has(p.id)) {
          const rv = p.reservedMove;
          out.push({
            owner, type: 'RESERVED_MOVE', pieceId: p.id,
            fromLayer: layer, fromR: r, fromC: c,
            toLayer: rv.toLayer, toR: rv.toR, toC: rv.toC,
            viaLayer: rv.viaLayer, viaR: rv.viaR, viaC: rv.viaC,
          });
        }
      }
    }
  }
  return out;
}

/** 両者の行動を、1つ目同士・2つ目同士…の組にする（組の中は先手が先） */
export function pairUp(p1: readonly Action[], p2: readonly Action[]): Action[][] {
  const pairs: Action[][] = [];
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const pair: Action[] = [];
    if (p1[i]) pair.push(p1[i]);
    if (p2[i]) pair.push(p2[i]);
    pairs.push(pair);
  }
  return pairs;
}

export interface TurnResult {
  log: string[];
  /** 組ごとの、ダメージを受けた駒の id */
  damaged: string[][];
  /** このターンに解決した全行動（予約移動の実行を含む） */
  actions: Action[];
}

/**
 * 画面なしで1ターン進める。順序は画面側の confirmTurn と同じ：
 * 予約移動を足す → 前処理（タイヤ・予約移動）→ 組ごとに解決 → ターン後処理 → ターン数を進める → 復活待ちを進める
 */
export function playTurn(state: GameState, p1Actions: readonly Action[], p2Actions: readonly Action[]): TurnResult {
  const p1 = [...p1Actions, ...collectReservedMoves(state, 'p1', p1Actions)];
  const p2 = [...p2Actions, ...collectReservedMoves(state, 'p2', p2Actions)];
  const pairs = pairUp(p1, p2);
  const actions = pairs.flat();
  const log: string[] = [];
  const damaged: string[][] = [];

  resolvePreamble(state, actions, log);
  for (const pair of pairs) {
    resolvePairActions(state, pair, log);
    damaged.push([...(state.damagedThisTurn ?? [])]);
    state.damagedThisTurn = [];
  }
  resolvePostTurn(state, log);
  state.turn++;
  tickReviveTimers(state);
  return { log, damaged, actions };
}
