// ===== STRATA — Game Logic =====
'use strict';

// Hex grid: 6 axial directions  (all pieces use same 6 directions)
const HEX6  = [[0,1],[0,-1],[1,0],[-1,0],[1,-1],[-1,1]];
const ORTHO = HEX6;
const ALL8  = HEX6;
const BS    = CONFIG.BOARD_SIZE;
const R     = CONFIG.BOARD_RADIUS;  // center index = R (e.g., 7)

/** Hex validity: max(|q|,|r|,|q+r|) <= BOARD_RADIUS */
function isValidCell(row, col) {
  if (row < 0 || row >= BS || col < 0 || col >= BS) return false;
  const q = col - R, r = row - R;
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= R;
}

/** Hex Manhattan distance between two cells */
function hexDist(r1, c1, r2, c2) {
  const q1 = c1 - R, rr1 = r1 - R;
  const q2 = c2 - R, rr2 = r2 - R;
  const dq = q1 - q2, dr = rr1 - rr2;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function inBounds(r, c) { return isValidCell(r, c); }

/** エコーゾーン：中心+隣接6マスの計7マス（ヘックス型） */
function echoZoneCells(centerR, centerC, layer) {
  const cells = [{ r: centerR, c: centerC, layer }];
  for (const [dr, dc] of HEX6) {
    const nr = centerR + dr, nc = centerC + dc;
    if (isValidCell(nr, nc)) cells.push({ r: nr, c: nc, layer });
  }
  return cells;
}

/** ダミー：旧 randomOccAPosition は削除（残存参照用に空関数として残す） */
function randomOccAPosition(state) {
  return { r: R, c: R };
}

// ── Terrain helpers ───────────────────────────────────────────────

/** Can a piece of given height pass THROUGH this terrain (not land on it)? */
function isPassable(terrain, pieceHeight) {
  if (terrain.type === 'flat') return true;
  if (terrain.type === 'vine') return true;           // vine is passable (slows but doesn't block)
  if (terrain.type === 'wall') {
    if (terrain.stage === 3) return false;
    if (terrain.stage >= 2 && pieceHeight < 3) return false;
    if (terrain.stage >= 1 && pieceHeight < 2) return false;
    return true;
  }
  if (terrain.type === 'hole') return true;
  return true;
}

/** Can a piece land on (end movement at) this terrain? */
function isLandable(terrain, pieceHeight) {
  if (terrain.type === 'vine') return true;           // can land on vine (gets slowed next turn)
  if (terrain.type === 'wall') {
    if (terrain.stage === 3) return false;
    if (terrain.stage >= 2 && pieceHeight < 3) return false;
    if (terrain.stage >= 1 && pieceHeight < 2) return false;
  }
  return true;
}

/** Remove a vine at the given position and update owner's vine list */
function removeVineAt(state, layer, r, c) {
  const cell = state[layer]?.[r]?.[c];
  if (!cell || cell.terrain.type !== 'vine') return;
  const owner = cell.terrain.placedBy;
  const vines = owner === 'p1' ? state.p1Vines : state.p2Vines;
  const idx = vines.findIndex(v => v.r === r && v.c === c && v.layer === layer);
  if (idx !== -1) vines.splice(idx, 1);
  cell.terrain = { type: 'flat', stage: 0 };
}

/** Apply terrain effect on landing (trap for holes) */
function applyLandingEffect(piece, terrain) {
  if (terrain.type === 'hole' && terrain.stage > 0 && piece.height < 3) {
    // Height-2 pieces can escape holes more easily but are still affected initially
    piece.trapped = true;
  }
}

// ── ZOC (Zone of Control) ─────────────────────────────────────────

/** Returns a Set of "${r},${c}" strings that are under enemy ZOC for the given owner */
function computeZOCCells(state, layer, forOwner) {
  const enemyOwner = forOwner === 'p1' ? 'p2' : 'p1';
  const zoc = new Set();
  for (let er = 0; er < BS; er++) {
    for (let ec = 0; ec < BS; ec++) {
      const p = state[layer][er][ec].piece;
      if (!p || p.owner !== enemyOwner || p.reviving) continue;
      if (p.type === 'WARDEN') {
        for (const [dr, dc] of HEX6) {
          const nr = er + dr, nc = ec + dc;
          if (isValidCell(nr, nc)) zoc.add(`${nr},${nc}`);
        }
      } else if (p.type === 'RANGER') {
        for (const [dr, dc] of HEX6) {
          for (let step = 1; step <= CONFIG.PIECES.RANGER.atkRange; step++) {
            const nr = er + dr * step, nc = ec + dc * step;
            if (!isValidCell(nr, nc)) break;
            zoc.add(`${nr},${nc}`);
            const t = state[layer][nr][nc].terrain;
            if (t.type === 'wall' && t.stage >= 2) break;
            if (state[layer][nr][nc].piece) break;
          }
        }
      }
    }
  }
  return zoc;
}

function isInEnemyZOC(state, layer, r, c, owner) {
  return computeZOCCells(state, layer, owner).has(`${r},${c}`);
}

/** Count how many distinct enemy pieces have ZOC over (r,c) */
function countZOCSources(state, layer, r, c, owner) {
  const enemyOwner = owner === 'p1' ? 'p2' : 'p1';
  let count = 0;
  for (let er = 0; er < BS; er++) {
    for (let ec = 0; ec < BS; ec++) {
      const p = state[layer][er][ec].piece;
      if (!p || p.owner !== enemyOwner || p.reviving) continue;
      if (p.type === 'WARDEN' && hexDist(r, c, er, ec) === 1) { count++; continue; }
      if (p.type === 'RANGER') {
        const dr = r - er, dc = c - ec;
        const adx = Math.abs(dr), ady = Math.abs(dc);
        const isOrtho = (adx === 0) !== (ady === 0);
        if (!isOrtho) continue;
        const stepR = Math.sign(dr), stepC = Math.sign(dc);
        let blocked = false;
        for (let s = 1; s <= CONFIG.PIECES.RANGER.atkRange; s++) {
          const mr = er + stepR * s, mc = ec + stepC * s;
          if (mr === r && mc === c) { if (!blocked) count++; break; }
          if (!isValidCell(mr, mc)) break;
          const t = state[layer][mr][mc].terrain;
          if (t.type === 'wall' && t.stage >= 2) break;
          if (state[layer][mr][mc].piece) break;
        }
      }
    }
  }
  return count;
}

// ── Valid moves ───────────────────────────────────────────────────

function getValidMoves(state, layer, r, c) {
  const cell = getCell(state, layer, r, c);
  if (!cell?.piece) return [];
  const piece = cell.piece;
  if (piece.reviving) return [];
  if (piece.trapped) return [];
  if (piece.surrounded) return [];

  const def = CONFIG.PIECES[piece.type];

  // Stage-2 wall: melee pieces are immobile (can't move off the wall)
  const myT = cell.terrain;
  if (myT.type === 'wall' && myT.stage >= 2 && def.atkRange <= 1) return [];
  const isFlying = def.height === 3;
  const dirs = def.moveDir === 'ortho' ? ORTHO : ALL8;

  // Compute effective move distance (ZOC and vineSlowed each reduce by 1)
  let effectiveDist = def.moveDist;
  if (piece.vineSlowed) effectiveDist = Math.max(1, effectiveDist - 1);
  if (isInEnemyZOC(state, layer, r, c, piece.owner)) effectiveDist = Math.max(1, effectiveDist - 1);

  const valid = [];
  const seen = new Set();

  if (effectiveDist === 1) {
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = state[layer][nr][nc];
      if (target.piece) continue;
      if (isFlying || (isPassable(target.terrain, def.height) && isLandable(target.terrain, def.height))) {
        const k = `${nr},${nc}`;
        if (!seen.has(k)) { seen.add(k); valid.push({ r:nr, c:nc, layer }); }
      }
    }
  } else {
    // Slide up to effectiveDist hexes in a straight line per direction
    for (const [dr, dc] of dirs) {
      for (let step = 1; step <= effectiveDist; step++) {
        const nr = r + dr * step, nc = c + dc * step;
        if (!inBounds(nr, nc)) break;
        const ncell = state[layer][nr][nc];
        if (ncell.piece) break;  // blocked by piece, stop this direction
        if (!isFlying && !isPassable(ncell.terrain, def.height)) break;
        if (isFlying || isLandable(ncell.terrain, def.height)) {
          const k = `${nr},${nc}`;
          if (!seen.has(k)) { seen.add(k); valid.push({ r:nr, c:nc, layer }); }
        }
      }
    }
  }

  return valid;
}

// ── Valid vine placement targets ──────────────────────────────────

function getValidVineTargets(state, layer, r, c) {
  const cell = getCell(state, layer, r, c);
  if (!cell?.piece) return [];
  const piece = cell.piece;
  if (piece.reviving) return [];
  const valid = [];
  const seen = new Set();
  for (const [dr, dc] of HEX6) {
    for (let step = 1; step <= CONFIG.VINE_RANGE; step++) {
      const nr = r + dr * step, nc = c + dc * step;
      if (!inBounds(nr, nc)) break;
      const target = state[layer][nr][nc];
      if (target.terrain.type === 'wall' && target.terrain.stage >= 2) break;
      if (target.piece) break;  // can't vine through occupied cells
      if (target.terrain.type === 'flat' || target.terrain.type === 'vine') {
        const k = `${nr},${nc}`;
        if (!seen.has(k)) { seen.add(k); valid.push({ r: nr, c: nc, layer }); }
      }
    }
  }
  return valid;
}

// ── Valid react watch targets ─────────────────────────────────────

function getValidReactTargets(state, layer, r, c) {
  const cell = getCell(state, layer, r, c);
  if (!cell?.piece) return [];
  const piece = cell.piece;
  if (piece.reviving) return [];
  const def = CONFIG.PIECES[piece.type];
  if (def.atkRange === 0) return [];
  // Any cell in attack range — watching for enemy to move there
  const valid = [];
  const seen = new Set();
  for (const [dr, dc] of HEX6) {
    for (let step = 1; step <= def.atkRange; step++) {
      const nr = r + dr * step, nc = c + dc * step;
      if (!inBounds(nr, nc)) break;
      const target = state[layer][nr][nc];
      if (target.terrain.type === 'wall' && target.terrain.stage >= 2) break;
      const k = `${nr},${nc}`;
      if (!seen.has(k)) { seen.add(k); valid.push({ r: nr, c: nc, layer }); }
      if (target.piece) break;
    }
  }
  return valid;
}

// ── Valid attacks ─────────────────────────────────────────────────

function getValidAttacks(state, layer, r, c) {
  const cell = getCell(state, layer, r, c);
  if (!cell?.piece) return [];
  const piece = cell.piece;
  if (piece.reviving) return [];
  const def = CONFIG.PIECES[piece.type];
  if (def.atkRange === 0) return [];

  // Wall elevation: piece STANDING ON a wall cell gets attack bonus
  const myTerrain = cell.terrain;
  let atkBonus = 0;
  if (myTerrain.type === 'wall' && myTerrain.stage >= 1) {
    atkBonus = myTerrain.stage;  // stage1 → +1, stage2 → +2
  }
  // Stage-2 wall immobility: melee cannot attack at all
  if (myTerrain.type === 'wall' && myTerrain.stage >= 2 && def.atkRange <= 1) {
    return [];
  }
  // Vine ally bonus: +1 if on own vine
  if (myTerrain.type === 'vine' && myTerrain.placedBy === piece.owner) {
    atkBonus = Math.max(atkBonus, 1);
  }
  const effectiveRange = def.atkRange + atkBonus;

  const valid = [];

  for (const [dr, dc] of HEX6) {
    // Normal range + 1 extra step to allow hitting elevated targets
    for (let step = 1; step <= effectiveRange + 1; step++) {
      const nr = r + dr * step, nc = c + dc * step;
      if (!inBounds(nr, nc)) break;
      const target = state[layer][nr][nc];

      if (target.terrain.type === 'wall' && target.terrain.stage >= 1) {
        if (target.terrain.stage >= 2) break;
        if (!target.piece) break;
      }

      if (target.piece) {
        if (target.piece.owner !== piece.owner && !target.piece.reviving) {
          // At step <= effectiveRange: always valid
          // At step == effectiveRange+1: only valid if target is elevated
          const targetElevated = target.terrain.type === 'wall' && target.terrain.stage >= 1;
          if (step <= effectiveRange || targetElevated) {
            valid.push({ r:nr, c:nc, layer });
          }
        }
        break;
      }
    }
  }

  // PHANTOM cross-layer attack
  if (piece.type === 'PHANTOM') {
    const other = layer === 'surface' ? 'depth' : 'surface';
    const otherCell = state[other][r][c];
    if (otherCell?.piece && otherCell.piece.owner !== piece.owner && !otherCell.piece.reviving) {
      valid.push({ r, c, layer: other });
    }
  }

  return valid;
}

// ── Valid terrain targets ─────────────────────────────────────────

function getValidTerrainTargets(state, layer, r, c) {
  const cell = getCell(state, layer, r, c);
  if (!cell?.piece) return [];
  const piece = cell.piece;
  if (piece.reviving) return [];
  const def = CONFIG.PIECES[piece.type];
  if (def.terrainRange === 0) return [];

  const seen = new Set();
  const valid = [];

  // Own cell: build wall under yourself (wall elevation mechanic)
  const ownT = cell.terrain;
  if (ownT.type === 'flat' || (ownT.type === 'wall' && ownT.stage < 3)) {
    seen.add(`${r},${c}`);
    valid.push({ r, c, layer });
  }

  for (const [dr, dc] of HEX6) {
    for (let step = 1; step <= def.terrainRange; step++) {
      const nr = r + dr * step, nc = c + dc * step;
      if (!inBounds(nr, nc)) break;
      const target = state[layer][nr][nc];
      if (target.terrain.stage < 3) {
        const k = `${nr},${nc}`;
        if (!seen.has(k)) { seen.add(k); valid.push({ r:nr, c:nc, layer }); }
      }
      if (target.piece) break;
    }
  }

  return valid;
}

// ── Terrain deformation ───────────────────────────────────────────

/** Change terrain one stage in direction 'up' (wall) or 'down' (hole).
 *  Applies membrane effect. Returns log string. */
function applyTerrainChange(state, layer, r, c, dir, owner) {
  const stages = 1;
  const cell  = state[layer][r][c];

  // If vine on this cell: remove vine first, then apply terrain change as if flat
  if (cell.terrain.type === 'vine') {
    removeVineAt(state, layer, r, c);
  }

  const t = cell.terrain;
  let changed = false;
  let logMsg  = '';

  for (let s = 0; s < stages; s++) {
    if (dir === 'up') {
      if (t.type === 'hole' && t.stage > 0) {
        t.stage--;
        if (t.stage === 0) t.type = 'flat';
        changed = true;
      } else if (t.type === 'flat' || t.type === 'wall') {
        if (t.type === 'flat') { t.type = 'wall'; t.stage = 1; }
        else if (t.stage < 3) t.stage++;
        changed = true;
      } else break;
    } else {
      if (t.type === 'wall' && t.stage > 0) {
        t.stage--;
        if (t.stage === 0) t.type = 'flat';
        changed = true;
      } else if (t.type === 'flat' || t.type === 'hole') {
        if (t.type === 'flat') { t.type = 'hole'; t.stage = 1; }
        else if (t.stage < 3) t.stage++;
        changed = true;
      } else break;
    }
  }
  if (changed) {
    logMsg = dir === 'up'
      ? `(${r},${c}) 凸${t.type==='flat'?'平地':`${t.stage}段階`}`
      : `(${r},${c}) 凹${t.type==='flat'?'平地':`${t.stage}段階`}`;

    // Fall damage: piece on this cell when wall is reduced
    if (dir === 'down' && cell.piece) {
      const standingPiece = cell.piece;
      const wasOnWall = (t.type === 'wall' || t.type === 'flat');
      if (wasOnWall) {
        standingPiece.hp = Math.max(0, standingPiece.hp - 1);
        logMsg += ` [${CONFIG.PIECE_LABEL[standingPiece.type]}落下-1HP]`;
      }
    }
  }

  if (!changed) return null;

  // Membrane: opposite layer, opposite type
  const otherLayer = layer === 'surface' ? 'depth' : 'surface';
  const oCell = state[otherLayer][r][c];
  const ot    = oCell.terrain;
  const oppositeDir = dir === 'up' ? 'down' : 'up';

  if (oppositeDir === 'down') {
    if (ot.type === 'flat') { ot.type = 'hole'; ot.stage = 1; }
    else if (ot.type === 'hole' && ot.stage < 3) ot.stage++;
  } else {
    if (ot.type === 'flat') { ot.type = 'wall'; ot.stage = 1; }
    else if (ot.type === 'wall' && ot.stage < 3) ot.stage++;
  }

  // If a piece is sitting in/on the updated terrain, apply effects
  const landedPiece = state[layer][r][c].piece;
  if (landedPiece) applyLandingEffect(landedPiece, state[layer][r][c].terrain);

  return logMsg;
}

// ── Escape from hole ──────────────────────────────────────────────

function tryEscape(state, layer, r, c) {
  const p = getPieceAt(state, layer, r, c);
  if (!p || !p.trapped) return false;
  const def = CONFIG.PIECES[p.type];
  if (def.height >= 2) {
    p.trapped = false;
    return true;
  }
  // Height 1: spend major action = escape
  p.trapped = false;
  return true;
}

// ── Transit helpers ───────────────────────────────────────────────

/** 浮上ポイント廃止 — どのマスからでも層移動可能 */
function getTransitDest(state, layer, r, c) {
  const piece = getPieceAt(state, layer, r, c);
  if (!piece || piece.reviving || piece.trapped) return null;
  const other = layer === 'surface' ? 'depth' : 'surface';
  if (state[other][r][c].piece) return null;   // 移動先が塞がっている
  return { layer: other, r, c };
}

// ── Echo Point helpers ────────────────────────────────────────────

/** エコーゾーンをランダム生成。表層と深層に各1中心（7マスクラスター）、
 *  距離ECHO_MIN_DIST〜ECHO_MAX_DISTの範囲で配置 */
function generateEchoPoints(state) {
  const ep  = state.echoPoint;
  const NR  = CONFIG.ECHO_NEUTRAL_R;
  const MIN = CONFIG.ECHO_MIN_DIST;
  const MAX = CONFIG.ECHO_MAX_DIST;
  let found = false;

  for (let attempt = 0; attempt < 600 && !found; attempt++) {
    // 中心候補（中立ゾーン内、かつ周囲6マスが全て有効）
    const sr = R - NR + Math.floor(Math.random() * (2 * NR + 1));
    const sc = R - NR + Math.floor(Math.random() * (2 * NR + 1));
    if (!isValidCell(sr, sc)) continue;
    // 7マスクラスター全体が有効かチェック
    if (echoZoneCells(sr, sc, 'surface').length < 7) continue;

    const dr = R - NR + Math.floor(Math.random() * (2 * NR + 1));
    const dc = R - NR + Math.floor(Math.random() * (2 * NR + 1));
    if (!isValidCell(dr, dc)) continue;
    if (echoZoneCells(dr, dc, 'depth').length < 7) continue;

    const dist = hexDist(sr, sc, dr, dc);
    if (dist < MIN || dist > MAX) continue;

    ep.surfaceR     = sr; ep.surfaceC = sc;
    ep.depthR       = dr; ep.depthC   = dc;
    ep.cycleTimer   = CONFIG.ECHO_CYCLE_TURNS;
    ep.cycleExpired = false;
    ep.holdTimer    = 0;
    ep.holdOwner    = null;
    ep.nextScoreAt  = CONFIG.ECHO_HOLD_TURNS;
    ep.active       = true;
    found = true;
  }

  if (!found) {
    ep.surfaceR = R;     ep.surfaceC = R;
    ep.depthR   = R - 2; ep.depthC   = R + 3;
    ep.cycleTimer   = CONFIG.ECHO_CYCLE_TURNS;
    ep.cycleExpired = false;
    ep.holdTimer    = 0;
    ep.holdOwner    = null;
    ep.nextScoreAt  = CONFIG.ECHO_HOLD_TURNS;
    ep.active       = true;
  }
}

/** エコーゾーンの制圧者を判定（7マス中に一方のみ→制圧、両軍→拮抗） */
function getEchoZoneController(state, layer, centerR, centerC) {
  const cells = echoZoneCells(centerR, centerC, layer);
  let p1 = 0, p2 = 0;
  for (const { r, c } of cells) {
    const p = getPieceAt(state, layer, r, c);
    if (!p || p.reviving || p.type === 'PHANTOM') continue;
    if (p.owner === 'p1') p1++;
    else p2++;
  }
  if (p1 > 0 && p2 > 0) return 'contested';
  if (p1 > 0) return 'p1';
  if (p2 > 0) return 'p2';
  return null;
}

/** エコーポイントの保持判定・連続スコア・サイクル管理（毎ターン呼ぶ） */
function updateEchoPoint(state) {
  const ep = state.echoPoint;
  if (!ep.active) return;

  const surfCtrl = getEchoZoneController(state, 'surface', ep.surfaceR, ep.surfaceC);
  const deptCtrl = getEchoZoneController(state, 'depth',   ep.depthR,   ep.depthC);
  state.occMeta.echoSurface = surfCtrl;
  state.occMeta.echoDepth   = deptCtrl;

  // 両ゾーンが同一プレイヤー（かつ拮抗なし）→ 保持カウント
  const bothHolder = (surfCtrl === deptCtrl && surfCtrl !== null && surfCtrl !== 'contested')
    ? surfCtrl : null;

  if (bothHolder !== null && bothHolder === ep.holdOwner) {
    ep.holdTimer++;
  } else {
    ep.holdOwner = bothHolder;
    ep.holdTimer = bothHolder ? 1 : 0;
    if (!bothHolder) ep.nextScoreAt = CONFIG.ECHO_HOLD_TURNS; // 保持解除でリセット
  }

  // スコア判定（連続スコア対応）
  if (ep.holdOwner !== null && ep.holdTimer >= ep.nextScoreAt) {
    state.occScore[ep.holdOwner]++;
    ep.nextScoreAt += CONFIG.ECHO_CONT_TURNS; // 次のスコア閾値を+2T
  }

  ep.cycleTimer--;
  if (ep.cycleTimer <= 0) ep.cycleExpired = true;

  // サイクル期限切れかつ誰も保持していない → 新エリア生成
  if (ep.cycleExpired && bothHolder === null) {
    generateEchoPoints(state);
  }
}

/** ENGINEER repair: adjacent friendly pieces with missing HP */
function getValidRepairTargets(state, layer, r, c) {
  const piece = getPieceAt(state, layer, r, c);
  if (!piece || piece.reviving) return [];
  const valid = [];
  for (const [dr, dc] of ORTHO) {
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    const target = state[layer][nr][nc].piece;
    if (target && target.owner === piece.owner && !target.reviving && target.hp < target.maxHp) {
      valid.push({ r: nr, c: nc, layer });
    }
  }
  return valid;
}

// ── Skill target helpers ──────────────────────────────────────────

/** WARDEN push: adjacent cells with pieces */
function getValidPushTargets(state, layer, r, c) {
  const valid = [];
  for (const [dr, dc] of ORTHO) {
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    const p = state[layer][nr][nc].piece;
    if (p && !p.reviving) valid.push({ r: nr, c: nc, layer });
  }
  return valid;
}

/** RANGER snipe: orthogonal range-5 attack targets */
function getValidSnipeTargets(state, layer, r, c) {
  const piece = getPieceAt(state, layer, r, c);
  if (!piece || piece.reviving) return [];
  const valid = [];
  for (const [dr, dc] of ORTHO) {
    for (let step = 1; step <= 5; step++) {
      const nr = r + dr * step, nc = c + dc * step;
      if (!inBounds(nr, nc)) break;
      const target = state[layer][nr][nc];
      if (target.terrain.type === 'wall' && target.terrain.stage >= 2) break;
      if (target.piece) {
        if (target.piece.owner !== piece.owner && !target.piece.reviving)
          valid.push({ r: nr, c: nc, layer });
        break;
      }
    }
  }
  return valid;
}

/** STRIKER swap: any piece within range-3 (all 8 dirs) */
function getValidSwapTargets(state, layer, r, c) {
  const piece = getPieceAt(state, layer, r, c);
  if (!piece || piece.reviving) return [];
  const valid = [];
  const seen = new Set();
  for (const [dr, dc] of ALL8) {
    for (let step = 1; step <= 3; step++) {
      const nr = r + dr * step, nc = c + dc * step;
      if (!inBounds(nr, nc)) break;
      const target = state[layer][nr][nc];
      if (target.piece && !target.piece.reviving) {
        const key = `${nr},${nc}`;
        if (!seen.has(key)) { valid.push({ r: nr, c: nc, layer }); seen.add(key); }
        break;
      }
      if (target.terrain.type === 'wall' && target.terrain.stage >= 1) break;
    }
  }
  return valid;
}

// ── Occupation update ─────────────────────────────────────────────

function getSquareController(state, layer, r, c) {
  const cell = state[layer]?.[r]?.[c];
  if (!cell?.piece) return null;
  const p = cell.piece;
  if (p.reviving) return null;
  if (p.type === 'PHANTOM') return null;  // PHANTOM denies all occupation
  return p.owner;
}

/** Area controller: requires at least half the cells (≥ ceil(n/2)) to control.
 *  cells must have {r, c, layer} */
function getAreaController(state, cells) {
  let p1 = 0, p2 = 0;
  for (const { r, c, layer } of cells) {
    const ctrl = getSquareController(state, layer ?? 'surface', r, c);
    if (ctrl === 'p1') p1++;
    else if (ctrl === 'p2') p2++;
  }
  const threshold = Math.ceil(cells.length / 2);   // majority threshold
  if (p1 >= threshold && p1 > p2) return 'p1';
  if (p2 >= threshold && p2 > p1) return 'p2';
  return null;
}

function updateOccupation(state) {
  updateEchoPoint(state);
}

// ── Victory check ─────────────────────────────────────────────────

function checkVictory(state) {
  // 先取勝利
  for (const owner of ['p1','p2']) {
    if (state.occScore[owner] >= CONFIG.WIN_SCORE) return owner;
  }
  // ターン制限
  if (state.turn > CONFIG.MAX_TURNS) {
    const s1 = state.occScore.p1, s2 = state.occScore.p2;
    if (s1 > s2) return 'p1';
    if (s2 > s1) return 'p2';
    return 'draw';
  }
  return null;
}

// ── Resolve simultaneous actions ──────────────────────────────────

/**
 * actions = array of action objects:
 * { owner, type:'MOVE'|'ATTACK'|'TERRAIN'|'DEPLOY'|'PASS',
 *   pieceId, fromLayer, fromR, fromC,
 *   toLayer, toR, toC,
 *   terrainDir }
 *
 * Returns array of log strings.
 */
function resolveActions(state, allActions) {
  const log = [];

  // ── Step 0: Clear per-turn status ───────────────────────
  for (const layer of ['surface','depth']) {
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        const p = state[layer][r][c].piece;
        if (p) { p.vineSlowed = false; p.surrounded = false; }
      }
    }
  }

  // ── Step 0.1: Charging → launch tires ─────────────────
  updateChargingSkills(state, log);

  // ── Step 0.2: Move all active tires ────────────────────
  if (state.tires.length > 0) processTires(state, log);

  // ── Step 1: Terrain + Vine placement ───────────────────
  // Vine placement (SKILL_VINE) processed first
  for (const a of allActions.filter(a => a.type === 'SKILL_VINE')) {
    const tCell = state[a.toLayer]?.[a.toR]?.[a.toC];
    if (!tCell) continue;
    if (tCell.piece) continue;  // can't place vine on occupied cell
    const t = tCell.terrain;
    if (t.type !== 'flat' && t.type !== 'vine') continue;

    // Remove existing vine on this cell if any
    if (t.type === 'vine') removeVineAt(state, a.toLayer, a.toR, a.toC);

    // Enforce max vines per player (auto-remove oldest)
    const ownerVines = a.owner === 'p1' ? state.p1Vines : state.p2Vines;
    if (ownerVines.length >= CONFIG.VINE_MAX) {
      const oldest = ownerVines.shift();
      const oldCell = state[oldest.layer]?.[oldest.r]?.[oldest.c];
      if (oldCell && oldCell.terrain.type === 'vine') {
        oldCell.terrain = { type: 'flat', stage: 0 };
      }
    }
    ownerVines.push({ r: a.toR, c: a.toC, layer: a.toLayer });
    tCell.terrain = { type: 'vine', stage: 1, placedBy: a.owner };
    const who = a.owner === 'p1' ? 'あなた' : 'CPU';
    // P1 sees own vine location; P2 vine hides coordinates
    if (a.owner === 'p1') log.push(`🌿蔦設置: ${who} (${a.toR},${a.toC})`);
    else                   log.push(`🌿蔦設置: ${who}`);
  }

  const terrainMap = {};
  for (const a of allActions.filter(a => a.type === 'TERRAIN')) {
    const key = `${a.toLayer}_${a.toR}_${a.toC}`;
    if (terrainMap[key]) {
      if (terrainMap[key].terrainDir !== a.terrainDir) {
        terrainMap[key] = 'CANCEL';
        log.push('地形変形: 競合キャンセル');
      }
    } else {
      terrainMap[key] = a;
    }
  }
  for (const [, a] of Object.entries(terrainMap)) {
    if (a === 'CANCEL') continue;
    const msg = applyTerrainChange(state, a.toLayer, a.toR, a.toC, a.terrainDir, a.owner);
    if (msg) {
      const who = a.owner === 'p1' ? 'あなた' : 'CPU';
      // P1's terrain shows coordinates; P2's hides them
      if (a.owner === 'p1') log.push(`地形変形: ${who} ${msg}`);
      else                   log.push(`地形変形: ${who}`);
    }
  }

  // ── Step 1.5: Reserved move execution ──────────────────
  for (const a of allActions.filter(a => a.type === 'RESERVED_MOVE')) {
    const srcLoc = findPieceById(state, a.pieceId);
    if (!srcLoc) continue;
    const who = srcLoc.piece.owner === 'p1' ? 'あなた' : 'CPU';
    const lbl = CONFIG.PIECE_LABEL[srcLoc.piece.type];

    // Move to intermediate (via) if set
    if (a.viaR != null) {
      const viaCell = state[a.viaLayer]?.[a.viaR]?.[a.viaC];
      if (viaCell && !viaCell.piece) {
        movePieceOnGrid(state, srcLoc.layer, srcLoc.r, srcLoc.c, a.viaLayer, a.viaR, a.viaC);
        applyLandingEffect(state[a.viaLayer][a.viaR][a.viaC].piece, state[a.viaLayer][a.viaR][a.viaC].terrain);
      }
    }

    // Move to final destination
    const newLoc = findPieceById(state, a.pieceId);
    if (!newLoc) continue;
    const dstCell = state[a.toLayer]?.[a.toR]?.[a.toC];
    if (dstCell && !dstCell.piece) {
      movePieceOnGrid(state, newLoc.layer, newLoc.r, newLoc.c, a.toLayer, a.toR, a.toC);
      applyLandingEffect(state[a.toLayer][a.toR][a.toC].piece, state[a.toLayer][a.toR][a.toC].terrain);
    }

    const finalLoc = findPieceById(state, a.pieceId);
    if (finalLoc) finalLoc.piece.reservedMove = null;
    log.push(`予約移動: ${who} ${lbl} → (${a.toR},${a.toC})`);
  }

  // ── Step 2: Movements ───────────────────────────────────
  const moveMap = {};
  for (const a of allActions.filter(a => a.type === 'MOVE')) {
    const key = `${a.toLayer}_${a.toR}_${a.toC}`;
    if (moveMap[key]) {
      moveMap[key] = 'BOUNCE';
      log.push(`移動衝突: バウンス (${a.toR},${a.toC})`);
    } else {
      moveMap[key] = a;
    }
  }
  for (const [, a] of Object.entries(moveMap)) {
    if (a === 'BOUNCE') continue;
    // Verify source piece still there (terrain change may have affected it)
    const srcCell = state[a.fromLayer]?.[a.fromR]?.[a.fromC];
    if (!srcCell?.piece || srcCell.piece.id !== a.pieceId) continue;
    // Verify destination still empty
    const dstCell = state[a.toLayer]?.[a.toR]?.[a.toC];
    if (!dstCell || dstCell.piece) continue;

    movePieceOnGrid(state, a.fromLayer, a.fromR, a.fromC, a.toLayer, a.toR, a.toC);
    // Apply landing effects
    const piece = state[a.toLayer][a.toR][a.toC].piece;
    applyLandingEffect(piece, state[a.toLayer][a.toR][a.toC].terrain);
    const lbl = CONFIG.PIECE_LABEL[piece.type];
    log.push(`${a.owner === 'p1' ? 'あなた' : 'CPU'} ${lbl} → (${a.toR},${a.toC})`);
  }

  // ── Step 2.5: Layer transits ─────────────────────────────
  for (const a of allActions.filter(a => a.type === 'TRANSIT')) {
    const srcCell = state[a.fromLayer]?.[a.fromR]?.[a.fromC];
    if (!srcCell?.piece || srcCell.piece.id !== a.pieceId) continue;
    const destCell = state[a.toLayer]?.[a.toR]?.[a.toC];
    if (!destCell || destCell.piece) continue;
    movePieceOnGrid(state, a.fromLayer, a.fromR, a.fromC, a.toLayer, a.toR, a.toC);
    const p = state[a.toLayer][a.toR][a.toC].piece;
    const who  = p.owner === 'p1' ? 'あなた' : 'CPU';
    const dest = a.toLayer === 'surface' ? '表層' : '深層';
    log.push(`層移動: ${who} ${CONFIG.PIECE_LABEL[p.type]} → ${dest} (${a.toR},${a.toC})`);
  }

  // ── Step 3: Deploy from hand ────────────────────────────
  for (const a of allActions.filter(a => a.type === 'DEPLOY')) {
    const hand = a.owner === 'p1' ? state.p1Hand : state.p2Hand;
    const idx  = hand.findIndex(p => p.id === a.pieceId);
    if (idx < 0) continue;
    const dstCell = state[a.toLayer]?.[a.toR]?.[a.toC];
    if (!dstCell || dstCell.piece) continue;
    const piece = hand.splice(idx, 1)[0];
    dstCell.piece = piece;
    log.push(`${a.owner === 'p1' ? 'あなた' : 'CPU'} ${CONFIG.PIECE_LABEL[piece.type]} 配置 (${a.toR},${a.toC})`);
  }

  // ── Step 4: Apply terrain effects at final positions ────
  for (const layer of ['surface','depth']) {
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        const cell = state[layer][r][c];
        if (!cell.piece) continue;
        applyLandingEffect(cell.piece, cell.terrain);
      }
    }
  }

  // ── Step 4.5: Apply vine slowing after all moves ────────
  applyVineEffects(state);

  // ── Step 5: Attacks ─────────────────────────────────────
  const damaged = {};  // pieceId → dmg (aggregate)
  for (const a of allActions.filter(a => a.type === 'ATTACK')) {
    const attLoc = findPieceById(state, a.pieceId);
    if (!attLoc) continue;

    const targetCell = state[a.toLayer]?.[a.toR]?.[a.toC];
    if (!targetCell?.piece) continue;
    if (targetCell.piece.owner === a.owner) continue;
    if (targetCell.piece.reviving) continue;

    // Quick range re-check after moves
    const dist = Math.max(
      Math.abs(attLoc.r - a.toR), Math.abs(attLoc.c - a.toC)
    );
    const def = CONFIG.PIECES[attLoc.piece.type];
    // Cross-layer attack (PHANTOM only)
    const sameLayer = attLoc.layer === a.toLayer;
    if (!sameLayer && attLoc.piece.type !== 'PHANTOM') continue;
    if (sameLayer && dist > def.atkRange) continue;
    if (!sameLayer && !(attLoc.r === a.toR && attLoc.c === a.toC)) continue;

    damaged[targetCell.piece.id] = (damaged[targetCell.piece.id] ?? 0) + 1;
  }

  // REACT: fire if enemy is on the watched cell after all moves
  for (const a of allActions.filter(a => a.type === 'REACT')) {
    const attLoc = findPieceById(state, a.pieceId);
    if (!attLoc) continue;
    const watchCell = state[a.toLayer]?.[a.toR]?.[a.toC];
    if (!watchCell?.piece) continue;
    if (watchCell.piece.owner === a.owner) continue;
    if (watchCell.piece.reviving) continue;
    const dist = hexDist(attLoc.r, attLoc.c, a.toR, a.toC);
    const def = CONFIG.PIECES[attLoc.piece.type];
    const atkBonus = isAdjacentToWall(state, attLoc.layer, attLoc.r, attLoc.c) ? 1 : 0;
    const reactWho = a.owner === 'p1' ? 'あなた' : 'CPU';
    if (dist <= def.atkRange + atkBonus) {
      damaged[watchCell.piece.id] = (damaged[watchCell.piece.id] ?? 0) + 1;
      if (a.owner === 'p1') log.push(`⚡反応発動: ${reactWho} ${CONFIG.PIECE_LABEL[attLoc.piece.type]} → (${a.toR},${a.toC})`);
      else                   log.push(`⚡反応発動: ${reactWho}`);
    } else {
      log.push(`⚡反応不発: ${reactWho}`);
    }
  }

  // SKILL_SNIPE (range-5 attack)
  for (const a of allActions.filter(a => a.type === 'SKILL_SNIPE')) {
    const sniper = findPieceById(state, a.pieceId);
    if (!sniper) continue;
    const tCell = state[a.toLayer]?.[a.toR]?.[a.toC];
    if (!tCell?.piece || tCell.piece.owner === sniper.piece.owner || tCell.piece.reviving) continue;
    const dr = Math.abs(sniper.r - a.toR), dc = Math.abs(sniper.c - a.toC);
    if ((dr > 0 && dc > 0) || dr + dc > 5) continue;  // ortho, max 5
    damaged[tCell.piece.id] = (damaged[tCell.piece.id] ?? 0) + 1;
    const who = sniper.piece.owner === 'p1' ? 'あなた' : 'CPU';
    if (sniper.piece.owner === 'p1') log.push(`狙撃: ${who} レンジャー → (${a.toR},${a.toC})`);
    else                             log.push(`狙撃: ${who} レンジャーが使用`);
  }

  // Collect damaged pieces for flash
  state.damagedThisTurn = Object.keys(damaged);

  // Apply damage and handle defeats
  for (const [pid, dmg] of Object.entries(damaged)) {
    const loc = findPieceById(state, pid);
    if (!loc) continue;
    loc.piece.hp -= dmg;
    const lbl = CONFIG.PIECE_LABEL[loc.piece.type];
    const who = loc.piece.owner === 'p1' ? 'あなた' : 'CPU';
    log.push(`ダメージ: ${who} ${lbl} -${dmg}HP (残${Math.max(0,loc.piece.hp)})`);

    if (loc.piece.hp <= 0) {
      // Check if already reviving (permanent elimination)
      if (loc.piece.reviving) {
        state[loc.layer][loc.r][loc.c].piece = null;
        log.push(`完全消滅: ${who} ${lbl}`);
      } else {
        transferToRevival(state, loc.layer, loc.r, loc.c);
        log.push(`転送: ${who} ${lbl} → 反対層へ`);
      }
    }
  }

  // ── Step 5.5: Non-damage skills ──────────────────────────

  // WARDEN push
  for (const a of allActions.filter(a => a.type === 'SKILL_PUSH')) {
    const wLoc = findPieceById(state, a.pieceId);
    if (!wLoc) continue;
    const tCell = state[a.toLayer]?.[a.toR]?.[a.toC];
    if (!tCell?.piece) continue;
    const dr = Math.sign(a.toR - wLoc.r), dc = Math.sign(a.toC - wLoc.c);
    const pr = a.toR + dr, pc = a.toC + dc;
    const who = wLoc.piece.owner === 'p1' ? 'あなた' : 'CPU';
    if (!inBounds(pr, pc)) { log.push(`押し出し: ${who} ウォーデン (盤外)`); continue; }
    const dCell = state[a.toLayer][pr][pc];
    if (dCell.piece || !isLandable(dCell.terrain, CONFIG.PIECES[tCell.piece.type].height)) {
      log.push(`押し出し: ${who} ウォーデン (阻止)`); continue;
    }
    const pushedPiece = tCell.piece;
    movePieceOnGrid(state, a.toLayer, a.toR, a.toC, a.toLayer, pr, pc);
    applyLandingEffect(pushedPiece, state[a.toLayer][pr][pc].terrain);
    if (wLoc.piece.owner === 'p1') log.push(`押し出し: ${who} ウォーデン → (${pr},${pc})`);
    else                           log.push(`押し出し: ${who} ウォーデンを使用`);
  }

  // ENGINEER repair
  for (const a of allActions.filter(a => a.type === 'SKILL_REPAIR')) {
    const engLoc = findPieceById(state, a.pieceId);
    if (!engLoc) continue;
    const tCell = state[a.toLayer]?.[a.toR]?.[a.toC];
    if (!tCell?.piece || tCell.piece.owner !== engLoc.piece.owner || tCell.piece.reviving) continue;
    tCell.piece.hp = Math.min(tCell.piece.hp + 1, tCell.piece.maxHp);
    const who = engLoc.piece.owner === 'p1' ? 'あなた' : 'CPU';
    log.push(`修繕: ${who} エンジニア → ${CONFIG.PIECE_LABEL[tCell.piece.type]} +1HP`);
  }

  // STRIKER position swap
  for (const a of allActions.filter(a => a.type === 'SKILL_SWAP')) {
    const sLoc = findPieceById(state, a.pieceId);
    if (!sLoc) continue;
    const tCell = state[a.toLayer]?.[a.toR]?.[a.toC];
    if (!tCell?.piece || tCell.piece.reviving) continue;
    const sCell = state[sLoc.layer][sLoc.r][sLoc.c];
    const tp = tCell.piece, sp = sCell.piece;
    sCell.piece = tp; tCell.piece = sp;
    applyLandingEffect(tp, sCell.terrain);
    applyLandingEffect(sp, tCell.terrain);
    const who = sp.owner === 'p1' ? 'あなた' : 'CPU';
    log.push(`位置交換: ${who} ストライカー ⇄ ${CONFIG.PIECE_LABEL[tp.type]}`);
  }

  // ROLLER charging start
  for (const a of allActions.filter(a =>
      a.type === 'SKILL_ROLLER_LIGHT' || a.type === 'SKILL_ROLLER_HEAVY')) {
    const loc = findPieceById(state, a.pieceId);
    if (!loc || loc.piece.chargingSkill) continue;  // already charging
    const dr = a.toR - a.fromR, dc = a.toC - a.fromC;
    const cooldown = a.type === 'SKILL_ROLLER_LIGHT'
      ? CONFIG.LIGHT_COOLDOWN : CONFIG.HEAVY_COOLDOWN;
    loc.piece.chargingSkill = {
      subtype: a.type === 'SKILL_ROLLER_LIGHT' ? 'light' : 'heavy',
      dir: [dr, dc], turnsLeft: cooldown,
    };
    const who = a.owner === 'p1' ? 'あなた' : 'CPU';
    const tn = a.type === 'SKILL_ROLLER_LIGHT' ? '軽' : '重';
    if (a.owner === 'p1') log.push(`🛞${tn}ローラーチャージ: ${who} (${cooldown}T後)`);
    else                   log.push(`🛞${tn}ローラーチャージ: ${who}`);
  }

  // ── Step 6: Escape from trap (if player used pass/escape action) ──
  for (const a of allActions.filter(a => a.type === 'ESCAPE')) {
    tryEscape(state, a.fromLayer, a.fromR, a.fromC);
    log.push(`脱出: (${a.fromR},${a.fromC})`);
  }

  // ── Step 6.5: Update surrounded status ──────────────────
  updateSurrounded(state);

  // ── Step 7: Occupation ──────────────────────────────────
  updateOccupation(state);

  const winner = checkVictory(state);
  if (winner) {
    state.winner = winner;
    state.phase  = 'GAME_OVER';
    log.push(`★ 勝利: ${winner === 'p1' ? 'あなた' : 'CPU'}`);
  }

  return log;
}

// ── Roller direction targets ──────────────────────────────────────

/** Returns the 6 adjacent cells as valid direction targets for roller skill */
function getValidRollerDirections(state, layer, r, c) {
  return HEX6
    .map(([dr, dc]) => ({ r: r + dr, c: c + dc, layer }))
    .filter(v => isValidCell(v.r, v.c));
}

// ── Tire processing ───────────────────────────────────────────────

/** Update charging cooldowns and launch tires that are ready */
function updateChargingSkills(state, log) {
  for (const layer of ['surface','depth']) {
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        const p = state[layer][r][c].piece;
        if (!p?.chargingSkill) continue;
        p.chargingSkill.turnsLeft--;
        if (p.chargingSkill.turnsLeft <= 0) {
          const { subtype, dir } = p.chargingSkill;
          state.tireCount++;
          state.tires.push({
            id: `t${state.tireCount}`,
            r, c, layer,
            dr: dir[0], dc: dir[1],
            subtype, owner: p.owner,
          });
          const who = p.owner === 'p1' ? 'あなた' : 'CPU';
          const typeName = subtype === 'light' ? '軽' : '重';
          log.push(`🛞${typeName}ローラー発射: ${who}`);
          p.chargingSkill = null;
        }
      }
    }
  }
}

/** Move all active tires and apply collision effects */
function processTires(state, log) {
  const toRemove = [];
  for (const tire of state.tires) {
    let { r, c, layer, dr, dc, subtype, owner } = tire;

    for (let step = 0; step < CONFIG.TIRE_SPEED; step++) {
      const nr = r + dr, nc = c + dc;

      // Off board → remove
      if (!isValidCell(nr, nc)) {
        toRemove.push(tire.id);
        log.push(`🛞タイヤが盤外へ`);
        break;
      }

      const cell = state[layer][nr][nc];

      // Vine on this cell → destroy vine, continue
      if (cell.terrain.type === 'vine') {
        removeVineAt(state, layer, nr, nc);
        log.push(`🛞タイヤが蔦を破壊`);
      }

      // Wall → damage wall stage, tire stops
      if (cell.terrain.type === 'wall' && cell.terrain.stage >= 1) {
        cell.terrain.stage--;
        if (cell.terrain.stage === 0) cell.terrain.type = 'flat';
        toRemove.push(tire.id);
        log.push(`🛞タイヤが壁に衝突（壁-1段）`);
        break;
      }

      // Piece collision
      if (cell.piece && !cell.piece.reviving) {
        const target = cell.piece;
        target.hp--;
        const who = target.owner === 'p1' ? 'あなた' : 'CPU';
        log.push(`🛞タイヤ直撃: ${who} ${CONFIG.PIECE_LABEL[target.type]} -1HP`);
        if (target.hp <= 0) {
          if (target.reviving) { state[layer][nr][nc].piece = null; }
          else { transferToRevival(state, layer, nr, nc); }
          log.push(`転送: ${who} ${CONFIG.PIECE_LABEL[target.type]}`);
        }
        if (subtype === 'light') {
          // Light stops here
          tire.r = nr; tire.c = nc;
          toRemove.push(tire.id);
          break;
        }
        // Heavy continues through — advance position but don't stop
        r = nr; c = nc;
        tire.r = nr; tire.c = nc;
      } else {
        // Empty cell — move tire forward
        r = nr; c = nc;
        tire.r = nr; tire.c = nc;
      }
    }
  }

  state.tires = state.tires.filter(t => !toRemove.includes(t.id));
}

// ── Hex line interpolation ────────────────────────────────────────

function hexRoundCoord(q, r) {
  const s = -q - r;
  let qi = Math.round(q), ri = Math.round(r), si = Math.round(s);
  const dq = Math.abs(qi - q), dr = Math.abs(ri - r), ds = Math.abs(si - s);
  if (dq > dr && dq > ds) qi = -ri - si;
  else if (dr > ds)        ri = -qi - si;
  return { row: ri + R, col: qi + R };
}

/** Returns all hex cells along the line from (r1,c1) to (r2,c2), inclusive */
function hexLineDraw(r1, c1, r2, c2, layer) {
  const q1 = c1 - R, rr1 = r1 - R;
  const q2 = c2 - R, rr2 = r2 - R;
  const N = hexDist(r1, c1, r2, c2);
  if (N === 0) return [];
  const cells = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const { row, col } = hexRoundCoord(q1 + (q2 - q1) * t, rr1 + (rr2 - rr1) * t);
    if (isValidCell(row, col)) cells.push({ r: row, c: col, layer });
  }
  return cells;
}

/** Compute all vine LINE cells (between anchors, excluding anchors) for a player */
function computeVineLines(state, owner) {
  const vines = owner === 'p1' ? state.p1Vines : state.p2Vines;
  const lines = [];
  for (let i = 0; i < vines.length; i++) {
    for (let j = i + 1; j < vines.length; j++) {
      if (vines[i].layer !== vines[j].layer) continue;
      const lyr = vines[i].layer;
      const cells = hexLineDraw(vines[i].r, vines[i].c, vines[j].r, vines[j].c, lyr);
      const middle = cells.filter(cl =>
        !(cl.r === vines[i].r && cl.c === vines[i].c) &&
        !(cl.r === vines[j].r && cl.c === vines[j].c)
      );
      if (middle.length > 0) lines.push({ cells: middle, layer: lyr });
    }
  }
  return lines;
}

// ── Reservation movement helpers ──────────────────────────────────

/** Valid 2-step reserve destinations (BFS depth 2) */
function getValidReserveMoves(state, layer, r, c) {
  const piece = state[layer]?.[r]?.[c]?.piece;
  if (!piece || piece.reviving || piece.trapped || piece.surrounded) return [];

  const step1 = getValidMoves(state, layer, r, c);
  const step1Keys = new Set(step1.map(v => `${v.r},${v.c}`));
  step1Keys.add(`${r},${c}`);

  const result = [];
  const seen = new Set(step1Keys);

  for (const via of step1) {
    // Temporarily move piece to via
    state[layer][r][c].piece = null;
    state[layer][via.r][via.c].piece = piece;

    const step2 = getValidMoves(state, layer, via.r, via.c);

    // Restore
    state[layer][via.r][via.c].piece = null;
    state[layer][r][c].piece = piece;

    for (const dest of step2) {
      const k = `${dest.r},${dest.c}`;
      if (!seen.has(k)) {
        seen.add(k);
        result.push({ r: dest.r, c: dest.c, layer, viaR: via.r, viaC: via.c, viaLayer: layer });
      }
    }
  }
  return result;
}

/** Valid intermediate cells for a specific reserve destination */
function getValidReserveVia(state, layer, r, c, toR, toC) {
  const piece = state[layer]?.[r]?.[c]?.piece;
  if (!piece) return [];

  const step1 = getValidMoves(state, layer, r, c);
  const result = [];

  for (const via of step1) {
    state[layer][r][c].piece = null;
    state[layer][via.r][via.c].piece = piece;

    const step2 = getValidMoves(state, layer, via.r, via.c);

    state[layer][via.r][via.c].piece = null;
    state[layer][r][c].piece = piece;

    if (step2.some(d => d.r === toR && d.c === toC)) {
      result.push({ r: via.r, c: via.c, layer });
    }
  }
  return result;
}

// ── Vine & ZOC post-resolution helpers ───────────────────────────

/** After moves resolve: mark pieces on enemy vines/vine-lines as vineSlowed next turn */
function applyVineEffects(state) {
  // Vine anchor cells
  for (const layer of ['surface','depth']) {
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        const cell = state[layer][r][c];
        const p = cell.piece;
        if (!p || p.reviving) continue;
        const t = cell.terrain;
        if (t.type === 'vine' && t.placedBy !== p.owner) {
          p.vineSlowed = true;
        }
      }
    }
  }

  // Vine line cells (rope between anchors)
  for (const owner of ['p1', 'p2']) {
    const enemyOwner = owner === 'p1' ? 'p2' : 'p1';
    const lines = computeVineLines(state, owner);
    for (const { cells, layer } of lines) {
      for (const { r, c } of cells) {
        const p = state[layer]?.[r]?.[c]?.piece;
        if (p && p.owner === enemyOwner && !p.reviving) {
          p.vineSlowed = true;
        }
      }
    }
  }
}

/** After resolution: mark pieces surrounded by 3+ ZOC sources */
function updateSurrounded(state) {
  for (const layer of ['surface','depth']) {
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        const p = state[layer][r][c].piece;
        if (!p || p.reviving) continue;
        p.surrounded = countZOCSources(state, layer, r, c, p.owner) >= 3;
      }
    }
  }
}

/** Check if (r,c) is adjacent to any wall stage 1+ */
function isAdjacentToWall(state, layer, r, c) {
  for (const [dr, dc] of HEX6) {
    const nr = r + dr, nc = c + dc;
    if (!isValidCell(nr, nc)) continue;
    const t = state[layer][nr][nc].terrain;
    if (t.type === 'wall' && t.stage >= 1) return true;
  }
  return false;
}

