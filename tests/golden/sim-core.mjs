// 画面なしで1試合を進める。ルールの実装（JS版・TS版）に依存しない形にしてある。
// api: ルール側の関数一式 + setRandom(fn)（ルール側の乱数を差し替える）
import { createHash } from 'node:crypto';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// キーの並び順に左右されない JSON（実装が変わっても同じ状態なら同じ文字列になる）
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 16);

// 先手（p1）の行動を、指せる手の中から乱数で選ぶ。種類を先に選ぶので、珍しい行動も記録に入る
function p1Candidates(api, G) {
  const C = api.CONFIG, by = {};
  const add = (type, a) => (by[type] ??= []).push({ owner: 'p1', type, ...a });
  for (const { layer, r, c, piece } of api.allPieces(G, 'p1')) {
    if (piece.reviving) continue;
    const base = { pieceId: piece.id, fromLayer: layer, fromR: r, fromC: c };
    const to = t => ({ toLayer: t.layer ?? layer, toR: t.r, toC: t.c });
    if (piece.trapped) { add('ESCAPE', { ...base, toLayer: layer, toR: r, toC: c }); continue; }
    for (const t of api.getValidMoves(G, layer, r, c)) add('MOVE', { ...base, ...to(t) });
    for (const t of api.getValidAttacks(G, layer, r, c)) add('ATTACK', { ...base, ...to(t) });
    for (const t of api.getValidReactTargets(G, layer, r, c)) add('REACT', { ...base, ...to(t) });
    const tr = api.getTransitDest(G, layer, r, c);
    if (tr) add('TRANSIT', { ...base, ...to(tr) });
    for (const t of api.getValidTerrainTargets(G, layer, r, c))
      for (const terrainDir of ['up', 'down']) add('TERRAIN', { ...base, ...to(t), terrainDir });
    if (piece.type === 'WARDEN')   for (const t of api.getValidPushTargets(G, layer, r, c))   add('SKILL_PUSH', { ...base, ...to(t) });
    if (piece.type === 'RANGER')   for (const t of api.getValidSnipeTargets(G, layer, r, c))  add('SKILL_SNIPE', { ...base, ...to(t) });
    if (piece.type === 'STRIKER')  for (const t of api.getValidSwapTargets(G, layer, r, c))   add('SKILL_SWAP', { ...base, ...to(t) });
    if (piece.type === 'ENGINEER') {
      for (const t of api.getValidRepairTargets(G, layer, r, c)) add('SKILL_REPAIR', { ...base, ...to(t) });
      for (const t of api.getValidVineTargets(G, layer, r, c))   add('SKILL_VINE', { ...base, ...to(t) });
    }
    if (piece.type === 'ROLLER' && !piece.chargingSkill)
      for (const t of api.getValidRollerDirections(G, layer, r, c))
        for (const type of ['SKILL_ROLLER_LIGHT', 'SKILL_ROLLER_HEAVY']) add(type, { ...base, ...to(t) });
    if (!piece.reservedMove)
      for (const t of api.getValidReserveMoves(G, layer, r, c)) add('RESERVE_SET', { ...base, dest: t });
  }
  for (const piece of G.p1Hand)
    for (let r = C.BOARD_SIZE - 4; r < C.BOARD_SIZE; r++)
      for (let c = 0; c < C.BOARD_SIZE; c++)
        if (api.isValidCell(r, c) && !G.surface[r][c].piece)
          add('DEPLOY', { pieceId: piece.id, toLayer: 'surface', toR: r, toC: c });
  return by;
}

function pickP1Actions(api, G, rnd) {
  const out = [];
  const n = rnd() < 0.85 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const by = p1Candidates(api, G);
    const types = Object.keys(by);
    if (types.length === 0) break;
    const list = by[types[Math.floor(rnd() * types.length)]];
    const a = list[Math.floor(rnd() * list.length)];
    if (a.type === 'RESERVE_SET') {
      // 画面側と同じく、予約は駒に直接書き込む（main.js の queueAction と同じ形）
      const { dest, ...rest } = a;
      const vias = api.getValidReserveVia(G, a.fromLayer, a.fromR, a.fromC, dest.r, dest.c);
      if (vias.length === 0) continue;
      const via = vias[Math.floor(rnd() * vias.length)];
      const loc = api.findPieceById(G, a.pieceId);
      loc.piece.reservedMove = {
        toR: dest.r, toC: dest.c, toLayer: dest.layer ?? a.fromLayer,
        viaR: via.r, viaC: via.c, viaLayer: via.layer ?? a.fromLayer,
      };
      out.push({ ...rest, toLayer: via.layer ?? a.fromLayer, toR: via.r, toC: via.c });
    } else out.push(a);
  }
  return out;
}

// main.js の confirmTurn と同じ順序で1ターン進める
export function playTurn(api, G, p1Actions) {
  // TypeScript 版は、ルール側の playTurn（src/game/turn.ts）をそのまま使う。
  // その下は、記録を取った時（素の JavaScript 版）の進め方。順序の基準として残してある
  if (api.playTurn) {
    const cpu = api.getCpuActions(G).map(a => ({ ...a, owner: 'p2' }));
    const r = api.playTurn(G, p1Actions, cpu);
    return { log: r.log, all: r.actions, damaged: r.damaged };
  }
  const p1 = [...p1Actions];
  const BS = api.CONFIG.BOARD_SIZE;
  // このターンに予約したばかりの駒は、次のターンから動く
  const newReserveIds = new Set(p1.filter(a => a.type === 'RESERVE_SET').map(a => a.pieceId));
  for (const layer of ['surface', 'depth'])
    for (let r = 0; r < BS; r++) for (let c = 0; c < BS; c++) {
      const p = G[layer][r][c].piece;
      if (p && p.owner === 'p1' && p.reservedMove && !newReserveIds.has(p.id)) {
        const rv = p.reservedMove;
        p1.push({ owner: 'p1', type: 'RESERVED_MOVE', pieceId: p.id, fromLayer: layer, fromR: r, fromC: c,
          toLayer: rv.toLayer, toR: rv.toR, toC: rv.toC, viaLayer: rv.viaLayer, viaR: rv.viaR, viaC: rv.viaC });
      }
    }
  const p2 = api.getCpuActions(G).map(a => ({ ...a, owner: 'p2' }));
  const pairs = [];
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const pair = [];
    if (p1[i]) pair.push(p1[i]);
    if (p2[i]) pair.push(p2[i]);
    pairs.push(pair);
  }
  const all = pairs.flat();
  // 前処理（タイヤ・予約移動）→ ペアごとに解決 → ターン後処理
  const log = [], damaged = [];
  api.resolvePreamble(G, all, log);
  for (const pair of pairs) {
    api.resolvePairActions(G, pair, log);
    damaged.push([...(G.damagedThisTurn ?? [])]);
    G.damagedThisTurn = [];
  }
  api.resolvePostTurn(G, log);
  G.turn++;
  api.tickReviveTimers(G);
  return { log, all, damaged };
}

export function runGame(api, seed, { maxTurns = 40, dump = false } = {}) {
  api.setRandom(mulberry32(seed));             // ルール側（エコーポイント・CPU）の乱数
  const drive = mulberry32(seed ^ 0x9E3779B9); // 先手の手を選ぶ乱数（ルール側と別系統）
  const G = api.createInitialState();
  api.generateEchoPoints(G);
  const turns = [hash(canonical(G))];
  const stats = {}, dumps = dump ? [canonical(G)] : null;
  while (G.phase !== 'GAME_OVER' && turns.length <= maxTurns) {
    const { log, all, damaged } = playTurn(api, G, pickP1Actions(api, G, drive));
    for (const a of all) stats[a.type] = (stats[a.type] ?? 0) + 1;
    const snap = canonical({ G, log, damaged });
    turns.push(hash(snap));
    if (dump) dumps.push(snap);
  }
  return { seed, turnsPlayed: turns.length - 1, winner: G.winner, score: G.occScore, turns, stats, dumps };
}
