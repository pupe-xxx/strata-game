// ===== STRATA — Game Logic =====
'use strict';

const ORTHO = [[0,1],[0,-1],[1,0],[-1,0]];
const ALL8  = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
const BS    = CONFIG.BOARD_SIZE;

/** Octagonal validity check — cuts corners per CORNER_CUT */
function isValidCell(r, c) {
  if (r < 0 || r >= BS || c < 0 || c >= BS) return false;
  const cut = CONFIG.CORNER_CUT;
  const n   = BS - 1;
  if (r + c       < cut) return false;
  if (r + (n - c) < cut) return false;
  if ((n - r) + c < cut) return false;
  if ((n - r) + (n - c) < cut) return false;
  return true;
}

function inBounds(r, c) { return isValidCell(r, c); }

/** 2×2 cells of the Area A zone (always surface layer) */
function occACells(r, c) {
  return [
    { r, c, layer:'surface' },
    { r, c:c+1, layer:'surface' },
    { r:r+1, c, layer:'surface' },
    { r:r+1, c:c+1, layer:'surface' },
  ];
}

/** Pick a random valid position for Area A zone (avoiding B zones) */
function randomOccAPosition(state) {
  const size = CONFIG.OCC_A_SIZE;
  for (let attempt = 0; attempt < 300; attempt++) {
    const r = 2 + Math.floor(Math.random() * (BS - size - 4));
    const c = 2 + Math.floor(Math.random() * (BS - size - 4));
    const cells = occACells(r, c);
    if (!cells.every(cl => isValidCell(cl.r, cl.c))) continue;
    // Don't overlap B zones
    const noB = state.occB.every(bp =>
      bCells(bp).every(b => !cells.some(cl => cl.r === b.r && cl.c === b.c)));
    if (noB) return { r, c };
  }
  return { r: Math.floor(BS / 2) - 1, c: Math.floor(BS / 2) - 1 };
}

// ── Terrain helpers ───────────────────────────────────────────────

/** Can a piece of given height pass THROUGH this terrain (not land on it)? */
function isPassable(terrain, pieceHeight) {
  if (terrain.type === 'flat') return true;
  if (terrain.type === 'wall') {
    if (terrain.stage === 3) return false;            // gate blocks movement
    if (terrain.stage >= 2 && pieceHeight < 3) return false;
    if (terrain.stage >= 1 && pieceHeight < 2) return false;
    return true;
  }
  if (terrain.type === 'hole') return true;           // holes are enterable (trapping)
  return true;
}

/** Can a piece land on (end movement at) this terrain? */
function isLandable(terrain, pieceHeight) {
  if (terrain.type === 'wall') {
    if (terrain.stage === 3) return false;            // gate: use transit action instead
    if (terrain.stage >= 2 && pieceHeight < 3) return false;
    if (terrain.stage >= 1 && pieceHeight < 2) return false;
  }
  return true;
}

/** Apply terrain effect on landing (trap for holes) */
function applyLandingEffect(piece, terrain) {
  if (terrain.type === 'hole' && terrain.stage > 0 && piece.height < 3) {
    // Height-2 pieces can escape holes more easily but are still affected initially
    piece.trapped = true;
  }
}

// ── Valid moves ───────────────────────────────────────────────────

function getValidMoves(state, layer, r, c) {
  const cell = getCell(state, layer, r, c);
  if (!cell?.piece) return [];
  const piece = cell.piece;
  if (piece.reviving) return [];
  if (piece.trapped) return [];  // trapped pieces can't move until they escape

  const def = CONFIG.PIECES[piece.type];
  const isFlying = def.height === 3;
  const dirs = def.moveDir === 'ortho' ? ORTHO : ALL8;
  const valid = [];

  if (def.moveDist === 1) {
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = state[layer][nr][nc];
      if (target.piece) continue;  // occupied
      if (isFlying) { valid.push({ r:nr, c:nc, layer }); continue; }
      if (!isPassable(target.terrain, def.height)) continue;
      if (!isLandable(target.terrain, def.height)) continue;
      valid.push({ r:nr, c:nc, layer });
    }
  } else {
    // Multi-step (STRIKER: 2 ortho steps, can stop at 1 or 2)
    for (const [dr, dc] of dirs) {
      // Step 1
      const r1 = r + dr, c1 = c + dc;
      if (!inBounds(r1, c1)) continue;
      const cell1 = state[layer][r1][c1];
      if (!cell1.piece) {
        if (isFlying || (isPassable(cell1.terrain, def.height) && isLandable(cell1.terrain, def.height))) {
          valid.push({ r:r1, c:c1, layer });
          // Step 2 (only if step 1 cell is truly empty to pass through)
          const r2 = r1 + dr, c2 = c1 + dc;
          if (!inBounds(r2, c2)) continue;
          const cell2 = state[layer][r2][c2];
          if (!cell2.piece) {
            if (isFlying || (isPassable(cell2.terrain, def.height) && isLandable(cell2.terrain, def.height))) {
              valid.push({ r:r2, c:c2, layer });
            }
          }
        }
      }
      // If step1 blocked by piece, no step 2 either
    }
  }

  // PHANTOM: also add cross-layer emerge from current position if on emergence point
  // (handled separately via transit action)

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

  const valid = [];
  const dirs = def.moveDir === 'ortho' ? ORTHO : ALL8;

  for (const [dr, dc] of dirs) {
    for (let step = 1; step <= def.atkRange; step++) {
      const nr = r + dr * step, nc = c + dc * step;
      if (!inBounds(nr, nc)) break;
      const target = state[layer][nr][nc];

      // Wall blocks line of sight (simplified)
      if (target.terrain.type === 'wall' && target.terrain.stage >= 1) {
        // Stage 1 wall: blocks height-1 attacker vs height-1 target, but not vs height 2+
        if (target.terrain.stage >= 2) break;
        // Stage 1: still break unless target would be height 2 (checked after)
        if (!target.piece) { break; }  // wall with no piece on it blocks
      }

      if (target.piece) {
        if (target.piece.owner !== piece.owner) {
          valid.push({ r:nr, c:nc, layer });
        }
        break;  // can't shoot through pieces
      }
    }
  }

  // PHANTOM cross-layer attack: attack same coordinate in other layer
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

  const valid = [];
  const dirs = ORTHO;   // terrain always orthogonal for range checks

  for (const [dr, dc] of dirs) {
    for (let step = 1; step <= def.terrainRange; step++) {
      const nr = r + dr * step, nc = c + dc * step;
      if (!inBounds(nr, nc)) break;
      const target = state[layer][nr][nc];

      // Can't deform if another piece is occupying the cell (or if terrain is already gate-stage)
      if (target.terrain.stage < 3) {
        valid.push({ r:nr, c:nc, layer });
      }
      // Terrain blocked by walls/pieces (range line-of-sight broken by pieces)
      if (target.piece) break;
    }
  }

  // Also include diagonal for SCULPTOR (moveDir:'all')
  if (def.moveDir === 'all') {
    for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = state[layer][nr][nc];
      if (target.terrain.stage < 3) valid.push({ r:nr, c:nc, layer });
    }
  }

  // Deduplicate
  const seen = new Set();
  return valid.filter(v => {
    const k = `${v.r},${v.c}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ── Terrain deformation ───────────────────────────────────────────

/** Change terrain one stage in direction 'up' (wall) or 'down' (hole).
 *  β DCP bonus: changes 2 stages at once. Applies membrane effect. Returns log string. */
function applyTerrainChange(state, layer, r, c, dir, owner) {
  // β DCP: TERRAIN_BOOST lets this piece's terrain change 2 stages instead of 1
  const stages = (owner && hasDCP(state, owner, 'TERRAIN_BOOST')) ? 2 : 1;
  const cell  = state[layer][r][c];
  const t     = cell.terrain;
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

// ── B-point helpers ──────────────────────────────────────────────

/** Bポイントの2×2エリアを返す（layer付き） */
function bCells(bp) {
  const layer = bp.layer ?? 'surface';
  return [
    { r: bp.r,   c: bp.c,   layer },
    { r: bp.r,   c: bp.c+1, layer },
    { r: bp.r+1, c: bp.c,   layer },
    { r: bp.r+1, c: bp.c+1, layer },
  ];
}

/** BポイントをランダムなOCC_A・他B非重複位置へ移動 */
function moveBPoints(state) {
  const BS   = CONFIG.BOARD_SIZE;
  const newB = state.occB.map(() => null);

  for (let bi = 0; bi < state.occB.length; bi++) {
    let placed = false;
    for (let attempt = 0; attempt < 100 && !placed; attempt++) {
      // 端から2マス以上内側に収める（2×2なので最大 BS-3）
      const nr = 1 + Math.floor(Math.random() * (BS - 4));
      const nc = 1 + Math.floor(Math.random() * (BS - 4));
      const cands = bCells({ r: nr, c: nc });

      // OCC_Aと重複しないか
      const noA = cands.every(cell =>
        !CONFIG.OCC_A.some(a => a.r === cell.r && a.c === cell.c));

      // 他のBポイントと重複しないか（確定済み分 + 元の位置）
      const noB = state.occB.every((other, oi) => {
        if (oi === bi) return true;
        const ref = newB[oi] ?? other;
        return bCells(ref).every(oc =>
          cands.every(cd => cd.r !== oc.r || cd.c !== oc.c));
      });

      if (noA && noB) { newB[bi] = { r: nr, c: nc, layer: state.occB[bi].layer }; placed = true; }
    }
    // 失敗しても現在位置のまま保持
    if (!placed) newB[bi] = { ...state.occB[bi] };
  }

  state.occB = newB;
  state.bMoveIn = CONFIG.B_MOVE_INTERVAL;
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
  // ── Area B (unchanged) ────────────────────────────────────────
  const ctrlB = state.occB.map(bp => getAreaController(state, bCells(bp)));
  state.occMeta.B0 = ctrlB[0];
  state.occMeta.B1 = ctrlB[1];

  // ── Area A Zone lifecycle ─────────────────────────────────────
  const zone = state.occAZone;
  zone.timer--;

  if (zone.phase === 'dormant' && zone.timer <= 0) {
    // Transition dormant → preview
    const pos = randomOccAPosition(state);
    zone.r = pos.r;
    zone.c = pos.c;
    zone.phase = 'preview';
    zone.timer = CONFIG.OCC_A_PREVIEW_TURNS;
  } else if (zone.phase === 'preview' && zone.timer <= 0) {
    // Transition preview → active
    zone.phase = 'active';
    zone.timer = CONFIG.OCC_A_ACTIVE_TURNS;
  } else if (zone.phase === 'active' && zone.timer <= 0) {
    // Score: give point to whoever controls the zone
    const ctrl = getAreaController(state, occACells(zone.r, zone.c));
    if (ctrl) state.occScore[ctrl]++;
    zone.phase = 'dormant';
    zone.timer = CONFIG.OCC_A_DORMANT_TURNS;
    zone.r = null;
    zone.c = null;
  }

  state.occMeta.A = (zone.phase === 'active' && zone.r !== null)
    ? getAreaController(state, occACells(zone.r, zone.c))
    : null;
}

// ── Victory check ─────────────────────────────────────────────────

function checkVictory(state) {
  for (const owner of ['p1','p2']) {
    if (state.occScore[owner] >= CONFIG.WIN_SCORE) return owner;
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

  // ── Step 1: Terrain changes ─────────────────────────────
  const terrainMap = {};
  for (const a of allActions.filter(a => a.type === 'TERRAIN')) {
    const key = `${a.toLayer}_${a.toR}_${a.toC}`;
    if (terrainMap[key]) {
      if (terrainMap[key].terrainDir !== a.terrainDir) {
        terrainMap[key] = 'CANCEL';
        log.push(`地形競合キャンセル: (${a.toR},${a.toC})`);
      }
      // same direction: ignore second (apply only once)
    } else {
      terrainMap[key] = a;
    }
  }
  for (const [, a] of Object.entries(terrainMap)) {
    if (a === 'CANCEL') continue;
    const msg = applyTerrainChange(state, a.toLayer, a.toR, a.toC, a.terrainDir, a.owner);
    if (msg) log.push(`地形変形: ${msg}`);
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
    // α DCP: FREE_EMERGE allows any destination coordinate (not just same cell)
    if (a.fromLayer === 'depth' && a.toLayer === 'surface') {
      if (a.toR !== a.fromR || a.toC !== a.fromC) {
        // Validate: must have FREE_EMERGE bonus
        if (!hasDCP(state, srcCell.piece.owner, 'FREE_EMERGE')) continue;
      }
    }
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
    log.push(`狙撃: ${who} レンジャー → (${a.toR},${a.toC})`);
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
    if (!inBounds(pr, pc)) { log.push(`押し出し: ${who} ウォーデン → 盤外`); continue; }
    const dCell = state[a.toLayer][pr][pc];
    if (dCell.piece || !isLandable(dCell.terrain, CONFIG.PIECES[tCell.piece.type].height)) {
      log.push(`押し出し: ${who} ウォーデン → 阻止`); continue;
    }
    const pushedPiece = tCell.piece;
    movePieceOnGrid(state, a.toLayer, a.toR, a.toC, a.toLayer, pr, pc);
    applyLandingEffect(pushedPiece, state[a.toLayer][pr][pc].terrain);
    log.push(`押し出し: ${who} ウォーデン → (${pr},${pc})`);
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

  // ── Step 6: Escape from trap (if player used pass/escape action) ──
  for (const a of allActions.filter(a => a.type === 'ESCAPE')) {
    tryEscape(state, a.fromLayer, a.fromR, a.fromC);
    log.push(`脱出: (${a.fromR},${a.fromC})`);
  }

  // ── Step 7: B-point countdown + DCP + Occupation ───────
  state.bMoveIn--;
  if (state.bMoveIn <= 0) {
    moveBPoints(state);
    state.bFlashUntil = Date.now() + 1400;
    log.push('★ Bポイントが移動しました');
  }
  updateDCP(state);
  updateOccupation(state);

  const winner = checkVictory(state);
  if (winner) {
    state.winner = winner;
    state.phase  = 'GAME_OVER';
    log.push(`★ 勝利: ${winner === 'p1' ? 'あなた' : 'CPU'}`);
  }

  return log;
}

// ── DCP control update ────────────────────────────────────────────

function updateDCP(state) {
  for (const dcp of CONFIG.DCP) {
    const p = state.depth[dcp.r]?.[dcp.c]?.piece;
    state.dcpControl[dcp.key] = (p && !p.reviving) ? p.owner : null;
  }
}

// ── Check if DCP bonus active ─────────────────────────────────────

function hasDCP(state, owner, effect) {
  return CONFIG.DCP.some(d => d.effect === effect && state.dcpControl[d.key] === owner);
}
