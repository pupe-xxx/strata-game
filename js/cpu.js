// ===== STRATA — CPU AI =====
'use strict';

const CpuAI = (() => {

  // ── Scoring helpers ───────────────────────────────────────────

  function distToOcc(state, r, c) {
    const dists = [];
    // Area A zone
    const zone = state.occAZone;
    if (zone && zone.r !== null && (zone.phase === 'preview' || zone.phase === 'active')) {
      for (const cl of occACells(zone.r, zone.c))
        dists.push(hexDist(r, c, cl.r, cl.c));
    }
    // Echo Points
    const ep = state.echoPoint;
    if (ep?.active) {
      dists.push(hexDist(r, c, ep.surfaceR, ep.surfaceC));
      dists.push(hexDist(r, c, ep.depthR,   ep.depthC));
    }
    return dists.length > 0 ? Math.min(...dists) : 999;
  }

  function scoreMove(state, fromLayer, fr, fc, tr, tc) {
    let score = 0;
    const piece = state[fromLayer][fr][fc].piece;
    if (!piece) return -999;

    const before = distToOcc(state, fr, fc);
    const after  = distToOcc(state, tr, tc);
    score += (before - after) * 3;

    const zone = state.occAZone;
    if (zone && zone.r !== null && zone.phase !== 'dormant') {
      const priority = zone.phase === 'active' ? 25 : 10;
      if (occACells(zone.r, zone.c).some(cl => tr === cl.r && tc === cl.c)) score += priority;
    }
    const ep = state.echoPoint;
    if (ep?.active) {
      if (fromLayer === 'surface' && tr === ep.surfaceR && tc === ep.surfaceC) score += 12;
      if (fromLayer === 'depth'   && tr === ep.depthR   && tc === ep.depthC)   score += 12;
    }

    for (const [dr, dc] of HEX6) {
      const nr = tr + dr, nc = tc + dc;
      if (!isValidCell(nr, nc)) continue;
      const p = state[fromLayer][nr][nc].piece;
      if (p && p.owner === 'p1') score -= 4;
    }

    const destCell = state[fromLayer][tr][tc];
    if (destCell.terrain.type === 'hole') score -= 10;
    // Avoid moving into enemy vine
    if (destCell.terrain.type === 'vine' && destCell.terrain.placedBy === 'p1') score -= 8;
    // Avoid ZOC cells if piece is valuable (HP > 1)
    if (piece.hp > 1 && isInEnemyZOC(state, fromLayer, tr, tc, 'p2')) score -= 5;

    return score;
  }

  function scoreAttack(state, layer, tr, tc) {
    const target = state[layer][tr][tc].piece;
    if (!target) return -999;

    let score = 10;
    const def = CONFIG.PIECES[target.type];

    // High priority: attack pieces on Area A zone or B points
    const zone2 = state.occAZone;
    if (zone2?.r !== null && zone2?.phase === 'active' &&
        occACells(zone2.r, zone2.c).some(cl => tr === cl.r && tc === cl.c)) score += 30;
    const ep2 = state.echoPoint;
    if (ep2?.active && ((tr === ep2.surfaceR && tc === ep2.surfaceC) || (tr === ep2.depthR && tc === ep2.depthC))) score += 20;

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
      // Submerging to depth: Echo depth point proximity bonus
      const ep = state.echoPoint;
      if (ep?.active && ep.depthR !== null) {
        const eDist = hexDist(r, c, ep.depthR, ep.depthC);
        if (eDist <= 3) score += 6;
        if (eDist === 0) score += 12;
      }
    }
    return score;
  }

  function scoreTerrain(state, layer, tr, tc, dir) {
    let score = 2;

    for (const [dr, dc] of HEX6) {
      const nr = tr + dr, nc = tc + dc;
      if (!isValidCell(nr, nc)) continue;
      const p = state[layer][nr][nc].piece;
      if (p) {
        if (p.owner === 'p1' && dir === 'up') score += 6;
        if (p.owner === 'p2' && dir === 'down') score -= 4;
      }
    }

    const target = state[layer][tr][tc].piece;
    if (target && target.owner === 'p1' && dir === 'down') score += 15;

    return score;
  }

  function scoreRollerDir(state, layer, r, c, dr, dc, subtype) {
    let score = 1;
    let nr = r, nc = c;
    for (let step = 0; step < 12; step++) {
      nr += dr; nc += dc;
      if (!isValidCell(nr, nc)) break;
      const cell = state[layer][nr][nc];
      if (cell.terrain.type === 'wall' && cell.terrain.stage >= 1) break;
      if (cell.piece) {
        if (cell.piece.owner === 'p1') score += 10;  // hits enemy
        if (cell.piece.owner === 'p2') score -= 6;   // hits ally
        if (subtype === 'light') break;  // light stops on first piece
      }
    }
    return score;
  }

  function scoreVine(state, layer, tr, tc) {
    let score = 3;
    // High value: vine on a cell enemy is likely to pass through (near occ zone)
    const distA = distToOcc(state, tr, tc);
    if (distA <= 2) score += 8;
    if (distA <= 1) score += 5;
    // Penalize placing vine on own piece paths
    for (const [dr, dc] of HEX6) {
      const nr = tr + dr, nc = tc + dc;
      if (!isValidCell(nr, nc)) continue;
      const p = state[layer][nr][nc].piece;
      if (p && p.owner === 'p2') score -= 3;
    }
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
        for (const t of getValidVineTargets(state, layer, r, c)) {
          candidates.push({
            type:'SKILL_VINE', pieceId:piece.id, owner:'p2',
            fromLayer:layer, fromR:r, fromC:c,
            toLayer:layer, toR:t.r, toC:t.c,
            score: scoreVine(state, layer, t.r, t.c),
          });
        }
      } else if (piece.type === 'ROLLER' && !piece.chargingSkill) {
        for (const [dr, dc] of HEX6) {
          const nr = r + dr, nc = c + dc;
          if (!isValidCell(nr, nc)) continue;
          for (const subtype of ['light', 'heavy']) {
            const s = scoreRollerDir(state, layer, r, c, dr, dc, subtype);
            if (s > 0) candidates.push({
              type: subtype === 'light' ? 'SKILL_ROLLER_LIGHT' : 'SKILL_ROLLER_HEAVY',
              pieceId: piece.id, owner: 'p2',
              fromLayer: layer, fromR: r, fromC: c,
              toLayer: layer, toR: nr, toC: nc,
              score: s + (subtype === 'heavy' ? -2 : 0),
            });
          }
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
