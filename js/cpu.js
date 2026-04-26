// ===== STRATA — CPU AI =====
'use strict';

const CpuAI = (() => {

  // ── Scoring helpers ───────────────────────────────────────────

  function distToOcc(state, r, c) {
    const dA  = Math.min(...CONFIG.OCC_A.map(a => Math.abs(r - a.r) + Math.abs(c - a.c)));
    const allB = state.occB.flatMap(bp => bCells(bp));
    const dBs = allB.map(b => Math.abs(r - b.r) + Math.abs(c - b.c));
    return Math.min(dA, ...dBs);
  }

  function scoreMove(state, fromLayer, fr, fc, tr, tc) {
    let score = 0;
    const piece = state[fromLayer][fr][fc].piece;
    if (!piece) return -999;

    // Closer to occupation squares is better for CPU (p2)
    const before = distToOcc(state, fr, fc);
    const after  = distToOcc(state, tr, tc);
    score += (before - after) * 3;

    // Bonus for standing on occupation squares
    if (CONFIG.OCC_A.some(a => tr === a.r && tc === a.c)) score += 20;
    if (state.occB.some(bp => bCells(bp).some(b => tr === b.r && tc === b.c))) score += 12;

    // Avoid cells adjacent to many enemy pieces (threat)
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nr = tr + dr, nc = tc + dc;
      if (nr < 0 || nr >= CONFIG.BOARD_SIZE || nc < 0 || nc >= CONFIG.BOARD_SIZE) continue;
      const p = state[fromLayer][nr][nc].piece;
      if (p && p.owner === 'p1') score -= 4;
    }

    // Penalty for moving into a hole
    const cell = state[fromLayer][tr][tc];
    if (cell.terrain.type === 'hole') score -= 10;

    return score;
  }

  function scoreAttack(state, layer, tr, tc) {
    const target = state[layer][tr][tc].piece;
    if (!target) return -999;

    let score = 10;
    const def = CONFIG.PIECES[target.type];

    // High priority: attack pieces standing on occupation squares
    if (CONFIG.OCC_A.some(a => tr === a.r && tc === a.c)) score += 30;
    if (state.occB.some(bp => bCells(bp).some(b => tr === b.r && tc === b.c))) score += 20;

    // Prefer killing low-HP targets (finish them off)
    score += (def.maxHp - target.hp) * 8;

    return score;
  }

  function scoreTransit(state, fromLayer, r, c) {
    let score = 1;
    if (fromLayer === 'depth') {
      // Emerging to surface: good if close to occupation target
      score += Math.max(0, 4 - distToOcc(state, r, c));
    } else {
      // Submerging to depth: good if close to a DCP
      const dcpDist = Math.min(...CONFIG.DCP.map(d => Math.abs(r-d.r)+Math.abs(c-d.c)));
      if (dcpDist <= 2) score += 5;
    }
    return score;
  }

  function scoreTerrain(state, layer, tr, tc, dir) {
    let score = 2;

    // Placing a wall between own pieces and enemy pieces is good
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nr = tr + dr, nc = tc + dc;
      if (nr < 0 || nr >= CONFIG.BOARD_SIZE || nc < 0 || nc >= CONFIG.BOARD_SIZE) continue;
      const p = state[layer][nr][nc].piece;
      if (p) {
        if (p.owner === 'p1' && dir === 'up') score += 6;   // wall blocking enemy
        if (p.owner === 'p2' && dir === 'down') score -= 4; // hole under own piece
      }
    }

    // Placing hole under enemy piece
    const target = state[layer][tr][tc].piece;
    if (target && target.owner === 'p1' && dir === 'down') score += 15;

    return score;
  }

  // ── Generate all candidate actions for CPU ────────────────────

  function getCandidates(state) {
    const candidates = [{ type:'PASS', score:0 }];
    const owner = 'p2';

    for (const { layer, r, c, piece } of allPieces(state, owner)) {
      if (piece.reviving) continue;

      // Move actions
      const moves = getValidMoves(state, layer, r, c);
      for (const { r:tr, c:tc } of moves) {
        candidates.push({
          type:'MOVE', pieceId:piece.id,
          fromLayer:layer, fromR:r, fromC:c,
          toLayer:layer, toR:tr, toC:tc,
          score: scoreMove(state, layer, r, c, tr, tc),
        });
      }

      // Attack actions
      const attacks = getValidAttacks(state, layer, r, c);
      for (const { r:tr, c:tc, layer:tl } of attacks) {
        candidates.push({
          type:'ATTACK', pieceId:piece.id,
          fromLayer:layer, fromR:r, fromC:c,
          toLayer:tl, toR:tr, toC:tc,
          score: scoreAttack(state, tl, tr, tc),
        });
      }

      // Transit (layer change)
      const transitDest = getTransitDest(state, layer, r, c);
      if (transitDest) {
        candidates.push({
          type: 'TRANSIT', pieceId: piece.id,
          fromLayer: layer, fromR: r, fromC: c,
          toLayer: transitDest.layer, toR: transitDest.r, toC: transitDest.c,
          score: scoreTransit(state, layer, r, c),
        });
      }

      // Skill actions
      if (piece.type === 'WARDEN') {
        for (const t of getValidPushTargets(state, layer, r, c)) {
          candidates.push({
            type:'SKILL_PUSH', pieceId:piece.id,
            fromLayer:layer, fromR:r, fromC:c,
            toLayer:layer, toR:t.r, toC:t.c,
            score: (state[layer][t.r][t.c].piece?.owner === 'p1') ? 8 : -2,
          });
        }
      } else if (piece.type === 'RANGER') {
        for (const t of getValidSnipeTargets(state, layer, r, c)) {
          candidates.push({
            type:'SKILL_SNIPE', pieceId:piece.id,
            fromLayer:layer, fromR:r, fromC:c,
            toLayer:layer, toR:t.r, toC:t.c,
            score: scoreAttack(state, layer, t.r, t.c) + 5,
          });
        }
      } else if (piece.type === 'STRIKER') {
        for (const t of getValidSwapTargets(state, layer, r, c)) {
          const tp = state[layer][t.r][t.c].piece;
          const swapScore = tp?.owner === 'p1'
            ? Math.max(0, 6 - distToOcc(state, t.r, t.c))   // pull enemy away from occ
            : distToOcc(state, t.r, t.c) < distToOcc(state, r, c) ? 7 : 2;
          candidates.push({
            type:'SKILL_SWAP', pieceId:piece.id,
            fromLayer:layer, fromR:r, fromC:c,
            toLayer:layer, toR:t.r, toC:t.c,
            score: swapScore,
          });
        }
      } else if (piece.type === 'ENGINEER') {
        for (const t of getValidRepairTargets(state, layer, r, c)) {
          candidates.push({
            type:'SKILL_REPAIR', pieceId:piece.id,
            fromLayer:layer, fromR:r, fromC:c,
            toLayer:layer, toR:t.r, toC:t.c,
            score: 6,
          });
        }
      }

      // Terrain actions
      const terrainTargets = getValidTerrainTargets(state, layer, r, c);
      for (const { r:tr, c:tc } of terrainTargets) {
        for (const dir of ['up','down']) {
          candidates.push({
            type:'TERRAIN', pieceId:piece.id,
            fromLayer:layer, fromR:r, fromC:c,
            toLayer:layer, toR:tr, toC:tc,
            terrainDir:dir,
            score: scoreTerrain(state, layer, tr, tc, dir),
          });
        }
      }
    }

    // Deploy from hand
    for (const piece of state.p2Hand) {
      // Deploy to back rows (rows 0-2 for 13×13)
      const deployRow = Math.floor(Math.random() * 3);
      for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
        if (!state.surface[deployRow]?.[c]?.piece) {
          candidates.push({
            type:'DEPLOY', pieceId:piece.id, pieceType:piece.type,
            owner:'p2',
            toLayer:'surface', toR:deployRow, toC:c,
            score: 3,
          });
        }
      }
    }

    return candidates;
  }

  // ── Pick two best actions ─────────────────────────────────────

  function getCpuActions(state) {
    const candidates = getCandidates(state);
    candidates.sort((a, b) => b.score - a.score);

    // Pick top action with some randomness (80% best, 20% top-5)
    function pickOne(pool) {
      if (pool.length === 0) return { type:'PASS', score:0 };
      if (Math.random() < 0.8) return pool[0];
      const top = pool.slice(0, Math.min(5, pool.length));
      return top[Math.floor(Math.random() * top.length)];
    }

    const action1 = pickOne(candidates);

    // For second action: exclude pieces already used
    const usedId = action1.pieceId;
    const remaining = candidates.filter(a => a.pieceId !== usedId);
    const action2 = pickOne(remaining);

    return [action1, action2].filter(a => a.type !== 'PASS');
  }

  return { getCpuActions };
})();
