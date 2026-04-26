// ===== STRATA — Canvas Renderer =====
'use strict';

const Renderer = (() => {
  let canvas, ctx;
  let scale = 1;
  let HW, HH, OX, OY;
  let viewDir = 0;  // 0=N 1=E 2=S 3=W
  const BS = CONFIG.BOARD_SIZE;

  // ── Piece sprite images ───────────────────────────────────────
  const pieceImages = {};

  // Map piece types to image file paths (relative to index.html)
  const PIECE_SPRITE = {
    WARDEN: 'assets/pieces/warden.jpg',
    // SCULPTOR: 'assets/pieces/sculptor.jpg',
    // STRIKER:  'assets/pieces/striker.jpg',
    // RANGER:   'assets/pieces/ranger.jpg',
    // PHANTOM:  'assets/pieces/phantom.jpg',
    // ENGINEER: 'assets/pieces/engineer.jpg',
  };

  function loadPieceImages() {
    for (const [type, path] of Object.entries(PIECE_SPRITE)) {
      const img = new Image();
      img.onload  = () => { pieceImages[type] = img; };
      img.onerror = () => { /* fallback to emoji */ };
      img.src = path;
    }
  }

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');
    resize();
    loadPieceImages();
  }

  function setViewDir(d) { viewDir = ((d % 4) + 4) % 4; }
  function getViewDir()  { return viewDir; }

  function resize() {
    const isMobile = window.innerWidth <= 700;
    const sideW    = isMobile ? 0 : 190 + 210 + 24;
    const headerH  = isMobile ? 44 : 52;
    // Mobile: reserve bottom panels (36vh) + controls (now 1 row ~44px)
    const reserveH = isMobile
      ? Math.round(window.innerHeight * 0.36) + 44
      : 80;  // PC: reserve controls area below canvas
    const availW   = window.innerWidth  - sideW - (isMobile ? 8 : 16);
    const availH   = window.innerHeight - headerH - reserveH;
    const scaleW   = availW  / CONFIG.CANVAS_W;
    const scaleH   = availH  / CONFIG.CANVAS_H;
    scale          = Math.max(0.28, Math.min(scaleW, scaleH, 1.0));
    canvas.width   = Math.round(CONFIG.CANVAS_W * scale);
    canvas.height  = Math.round(CONFIG.CANVAS_H * scale);
    HW = CONFIG.HW       * scale;
    HH = CONFIG.HH       * scale;
    OX = CONFIG.ORIGIN_X * scale;
    OY = CONFIG.ORIGIN_Y * scale;
  }

  // ── Coordinate transforms ─────────────────────────────────────

  function toViewCoords(r, c) {
    switch (viewDir) {
      case 0: return { vr: r,      vc: c        };
      case 1: return { vr: BS-1-c, vc: r        };
      case 2: return { vr: BS-1-r, vc: BS-1-c   };
      case 3: return { vr: c,      vc: BS-1-r   };
    }
  }

  function cellToScreen(r, c) {
    const { vr, vc } = toViewCoords(r, c);
    return {
      x: (vc - vr) * HW + OX,
      y: (vc + vr) * HH + OY,
    };
  }

  function screenToCell(px, py) {
    const relX = px - OX;
    const relY = py - OY;
    const vc   = (relX / HW + relY / HH) / 2;
    const vr   = (relY / HH - relX / HW) / 2;
    const col  = Math.round(vc);
    const row  = Math.round(vr);
    let r, c;
    switch (viewDir) {
      case 0: r = row;      c = col;        break;
      case 1: r = col;      c = BS-1-row;   break;
      case 2: r = BS-1-row; c = BS-1-col;   break;
      case 3: c = row;      r = BS-1-col;   break;
    }
    if (isValidCell(r, c)) return { r, c };
    return null;
  }

  // ── Diamond helpers ───────────────────────────────────────────

  function diamond(x, y, hw, hh) {
    ctx.beginPath();
    ctx.moveTo(x,      y - hh);
    ctx.lineTo(x + hw, y);
    ctx.lineTo(x,      y + hh);
    ctx.lineTo(x - hw, y);
    ctx.closePath();
  }

  function drawCell(r, c, fillColor, strokeColor) {
    const { x, y } = cellToScreen(r, c);
    diamond(x, y, HW, HH);
    if (fillColor)  { ctx.fillStyle = fillColor; ctx.fill(); }
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth   = 0.8 * scale;
      ctx.stroke();
    }
  }

  // ── Terrain rendering ─────────────────────────────────────────

  function drawTerrain(r, c, terrain) {
    if (terrain.type === 'flat' || terrain.stage === 0) return;
    const { x, y } = cellToScreen(r, c);
    const C        = CONFIG.CLR;

    if (terrain.type === 'wall') {
      const colors = [null, C.WALL_1, C.WALL_2, C.WALL_3];
      const col    = colors[terrain.stage] ?? C.WALL_1;
      const lift   = terrain.stage * HH * 0.45;
      diamond(x, y - lift, HW * 0.88, HH * 0.88);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1 * scale;
      ctx.stroke();
      // Side face
      ctx.beginPath();
      ctx.moveTo(x,              y - lift + HH * 0.88);
      ctx.lineTo(x + HW * 0.88, y - lift);
      ctx.lineTo(x + HW * 0.88, y);
      ctx.lineTo(x,              y + HH * 0.88);
      ctx.closePath();
      ctx.fillStyle = shadeColor(col, -0.3);
      ctx.fill();
      if (terrain.stage === 3) drawGateSymbol(x, y - lift);
    } else if (terrain.type === 'hole') {
      const colors = [null, C.HOLE_1, C.HOLE_2, C.HOLE_3];
      const col    = colors[terrain.stage] ?? C.HOLE_1;
      diamond(x, y, HW * 0.78, HH * 0.78);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = terrain.stage === 3 ? C.WALL_3 : '#1a3020';
      ctx.lineWidth = 1.5 * scale;
      ctx.stroke();
      if (terrain.stage === 3) drawGateSymbol(x, y);
    }
  }

  function drawGateSymbol(x, y) {
    ctx.font = `bold ${Math.max(10, 12 * scale)}px monospace`;
    ctx.fillStyle = '#ffd700';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⬡', x, y);
  }

  function shadeColor(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + pct * 255 | 0));
    const g = Math.min(255, Math.max(0, ((n >>  8) & 0xff) + pct * 255 | 0));
    const b = Math.min(255, Math.max(0, ((n)       & 0xff) + pct * 255 | 0));
    return `rgb(${r},${g},${b})`;
  }

  // ── Piece rendering — standing on tile (chess-piece style) ──────

  // Piece height in screen pixels based on piece.height attribute
  function pieceStandingH(def) {
    return HH * (2.2 + def.height * 0.55);
  }

  function drawPiece(r, c, piece, isSelected, posOverrides, flashSet) {
    let x, y;
    if (posOverrides && posOverrides.has(piece.id)) {
      const ov = posOverrides.get(piece.id);
      x = ov.x; y = ov.y;
    } else {
      const pos = cellToScreen(r, c);
      x = pos.x; y = pos.y;
    }

    const def    = CONFIG.PIECES[piece.type];
    const isP1   = piece.owner === 'p1';
    const accent = isSelected ? '#ffe600' : (isP1 ? CONFIG.CLR.P1 : CONFIG.CLR.P2);
    const standH = pieceStandingH(def);

    const hasSprite = pieceImages[piece.type] && !piece.reviving && !piece.trapped;

    // Ground shadow ellipse
    ctx.beginPath();
    ctx.ellipse(x + 1.5*scale, y + 1*scale, HW * 0.42, HH * 0.25, 0, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    // Selected glow ring at base
    if (isSelected) {
      ctx.beginPath();
      ctx.ellipse(x, y, HW * 0.5, HH * 0.32, 0, 0, Math.PI*2);
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth   = 2.5 * scale;
      ctx.stroke();
      // Soft inner glow
      ctx.beginPath();
      ctx.ellipse(x, y, HW * 0.62, HH * 0.4, 0, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,230,0,0.2)';
      ctx.lineWidth   = 4 * scale;
      ctx.stroke();
    }

    if (hasSprite) {
      drawSpriteStanding(x, y, piece, isSelected, accent, standH);
    } else {
      drawChessPieceShape(x, y, piece, isSelected, accent, standH, def);
    }

    // HP bar at tile base
    drawHpBar(x, y + HH * 0.38, piece);

    // Damage flash overlay
    if (flashSet && flashSet.has(piece.id)) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#ff1744';
      ctx.beginPath();
      ctx.ellipse(x, y - standH * 0.5, HW * 0.44, standH * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Sprite mode: image standing on tile ───────────────────────

  function drawSpriteStanding(x, y, piece, isSelected, accent, standH) {
    const img     = pieceImages[piece.type];
    const aspect  = img.naturalHeight > 0 ? img.naturalHeight / img.naturalWidth : 1.4;
    const spriteH = standH;
    const spriteW = spriteH / aspect;
    const dx = x - spriteW / 2;
    const dy = y - spriteH;   // feet at tile center y, head extends upward

    // Selected glow behind sprite
    if (isSelected) {
      ctx.save();
      ctx.shadowColor  = '#ffe600';
      ctx.shadowBlur   = 18 * scale;
      ctx.globalAlpha  = 0.6;
      ctx.drawImage(img, dx, dy, spriteW, spriteH);
      ctx.restore();
    }

    // Sprite itself
    ctx.drawImage(img, dx, dy, spriteW, spriteH);

    // Owner color indicator bar at the bottom of sprite
    const barH = 3 * scale;
    ctx.fillStyle = accent;
    ctx.fillRect(dx, y - barH, spriteW, barH);

    // Status badge (reviving / trapped) overlaid at top of sprite
    drawStatusBadge(x, dy, piece);
  }

  // ── Chess piece shape: 3D pawn-style ─────────────────────────

  function drawChessPieceShape(x, y, piece, isSelected, accent, standH, def) {
    const isP1     = piece.owner === 'p1';
    const bodyCol  = piece.reviving ? CONFIG.CLR.REVIVING
                   : piece.trapped  ? CONFIG.CLR.TRAPPED
                   : (isP1 ? '#e8e8e8' : '#12192b');
    const darkCol  = shadeColor(isP1 ? '#e8e8e8' : '#12192b', isP1 ? -0.25 : -0.2);

    const baseW   = HW * 0.52;
    const baseH   = HH * 0.3;
    const stemTop = y - standH;
    const stemW   = HW * 0.18 + def.height * HW * 0.015;
    const headR   = HW * 0.28 + def.height * HW * 0.03;

    // ── Base disc ──
    ctx.beginPath();
    ctx.ellipse(x, y, baseW, baseH, 0, 0, Math.PI*2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y, baseW * 0.75, baseH * 0.75, 0, 0, Math.PI*2);
    ctx.fillStyle = bodyCol;
    ctx.fill();

    // ── Body (tapered trapezoid, 3D shaded) ──
    const gradBody = ctx.createLinearGradient(x - stemW * 1.3, 0, x + stemW * 1.3, 0);
    gradBody.addColorStop(0,   darkCol);
    gradBody.addColorStop(0.4, bodyCol);
    gradBody.addColorStop(1,   darkCol);
    ctx.beginPath();
    ctx.moveTo(x - stemW * 1.3, y - baseH * 0.5);
    ctx.lineTo(x + stemW * 1.3, y - baseH * 0.5);
    ctx.lineTo(x + stemW * 0.8, stemTop + headR);
    ctx.lineTo(x - stemW * 0.8, stemTop + headR);
    ctx.closePath();
    ctx.fillStyle = gradBody;
    ctx.fill();

    // ── Collar ring (just below head) ──
    const collarY = stemTop + headR * 1.1;
    ctx.beginPath();
    ctx.ellipse(x, collarY, stemW * 1.5, stemW * 0.55, 0, 0, Math.PI*2);
    ctx.fillStyle = accent;
    ctx.fill();

    // ── Head circle ──
    const headY = stemTop;
    // head shadow
    ctx.beginPath();
    ctx.arc(x + 1.5*scale, headY + 2*scale, headR, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    // head body
    const gradHead = ctx.createRadialGradient(x - headR*0.3, headY - headR*0.3, 0, x, headY, headR);
    gradHead.addColorStop(0, isP1 ? '#ffffff' : '#2a3a5a');
    gradHead.addColorStop(1, bodyCol);
    ctx.beginPath();
    ctx.arc(x, headY, headR, 0, Math.PI*2);
    ctx.fillStyle = gradHead;
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth   = (isSelected ? 2.5 : 1.5) * scale;
    ctx.stroke();

    // ── Icon in head ──
    if (piece.reviving || piece.trapped) {
      const sfz = Math.max(7, Math.round(9 * scale));
      ctx.font         = `bold ${sfz}px monospace`;
      ctx.fillStyle    = piece.reviving ? '#e040fb' : CONFIG.CLR.TRAPPED;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(piece.reviving ? `復${piece.reviveTimer}` : '捕', x, headY);
    } else {
      const fz = Math.max(9, Math.round(13 * scale));
      ctx.font         = `${fz}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CONFIG.PIECE_EMOJI[piece.type], x, headY + 0.5*scale);
    }
  }

  // ── Status badge for sprite mode ─────────────────────────────

  function drawStatusBadge(x, topY, piece) {
    if (!piece.reviving && !piece.trapped) return;
    const label = piece.reviving ? `復${piece.reviveTimer}` : '捕';
    const col   = piece.reviving ? '#e040fb' : CONFIG.CLR.TRAPPED;
    const badgeR = 9 * scale;
    ctx.beginPath();
    ctx.arc(x, topY + badgeR, badgeR, 0, Math.PI*2);
    ctx.fillStyle = '#0d1117';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth   = 1.5 * scale;
    ctx.stroke();
    ctx.font         = `bold ${Math.max(7, 8*scale)}px monospace`;
    ctx.fillStyle    = col;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, topY + badgeR);
  }

  function drawHpBar(x, baseY, piece) {
    const w  = HW * 0.72;
    const h  = 3 * scale;
    const bx = x - w / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 1, baseY - 1, w + 2, h + 2);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(bx, baseY, w, h);
    const pct = piece.hp / piece.maxHp;
    ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#f44336';
    ctx.fillRect(bx, baseY, w * pct, h);
  }

  // ── Special markers ───────────────────────────────────────────

  function drawSpecialMarkers(state, layer) {
    const C = CONFIG.CLR;
    if (layer === 'surface') {
      // ── Area A Zone ──────────────────────────────────────────
      const zone = state.occAZone;
      if (zone && zone.r !== null && (zone.phase === 'preview' || zone.phase === 'active')) {
        const cells = occACells(zone.r, zone.c);
        const isActive = zone.phase === 'active';
        const ctrlA = state.occMeta?.A;

        for (const pos of cells) {
          const { x, y } = cellToScreen(pos.r, pos.c);
          diamond(x, y, HW, HH);
          if (isActive && ctrlA) {
            ctx.fillStyle = ctrlA === 'p1' ? 'rgba(79,195,247,0.25)' : 'rgba(239,83,80,0.25)';
          } else {
            ctx.fillStyle = isActive ? 'rgba(255,215,0,0.20)' : C.OCC_A_PRE;
          }
          ctx.fill();
          ctx.strokeStyle = isActive ? C.OCC_A : 'rgba(255,215,0,0.5)';
          ctx.lineWidth = (isActive ? 1.5 : 0.8) * scale;
          ctx.stroke();
        }
        // Label on center cell
        const label = isActive ? `★A残${zone.timer}` : `★A予${zone.timer}`;
        drawMarkerRing(zone.r, zone.c, isActive ? C.OCC_A : 'rgba(255,215,0,0.6)', label);
      }

      // ── B-move flash ──
      const isFlashing = Date.now() < (state.bFlashUntil ?? 0);

      // ── OCC_B: B1(surface) only drawn here; B2(depth) drawn in depth pass ──
      state.occB.forEach((bp, i) => {
        if ((bp.layer ?? 'surface') !== 'surface') return;
        const ctrlBi = state.occMeta?.[`B${i}`];
        for (const cell of bCells(bp)) {
          const { x, y } = cellToScreen(cell.r, cell.c);
          if (isFlashing) {
            diamond(x, y, HW, HH);
            ctx.fillStyle = 'rgba(129,199,132,0.45)';
            ctx.fill();
          } else if (ctrlBi) {
            const fillCol = ctrlBi === 'p1' ? 'rgba(79,195,247,0.18)' : 'rgba(239,83,80,0.18)';
            diamond(x, y, HW, HH);
            ctx.fillStyle = fillCol;
            ctx.fill();
          }
          drawMarkerRing(cell.r, cell.c, C.OCC_B, '');
        }
        drawMarkerRing(bp.r, bp.c, C.OCC_B, `B${i+1}`);
      });
    }
    if (layer === 'depth') {
      for (const dcp of CONFIG.DCP) {
        drawMarkerRing(dcp.r, dcp.c, C.DCP, dcp.label);
      }
      // B2 (depth B-point)
      const isFlashing = Date.now() < (state.bFlashUntil ?? 0);
      state.occB.forEach((bp, i) => {
        if ((bp.layer ?? 'surface') !== 'depth') return;
        const ctrlBi = state.occMeta?.[`B${i}`];
        for (const cell of bCells(bp)) {
          const { x, y } = cellToScreen(cell.r, cell.c);
          if (isFlashing) {
            diamond(x, y, HW, HH);
            ctx.fillStyle = 'rgba(129,199,132,0.45)';
            ctx.fill();
          } else if (ctrlBi) {
            const fillCol = ctrlBi === 'p1' ? 'rgba(79,195,247,0.18)' : 'rgba(239,83,80,0.18)';
            diamond(x, y, HW, HH);
            ctx.fillStyle = fillCol;
            ctx.fill();
          }
          drawMarkerRing(cell.r, cell.c, C.OCC_B, '');
        }
        drawMarkerRing(bp.r, bp.c, C.OCC_B, `B${i+1}`);
      });
    }
  }

  function drawMarkerRing(r, c, color, label) {
    const { x, y } = cellToScreen(r, c);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5 * scale;
    ctx.setLineDash([3*scale, 3*scale]);
    diamond(x, y, HW * 0.95, HH * 0.95);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `bold ${Math.max(7, 9*scale)}px monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y - HH * 0.6);
  }

  // ── Highlights ────────────────────────────────────────────────

  function drawHighlights(validCells, actionMode) {
    const C   = CONFIG.CLR;
    const col = actionMode === 'ATTACK'  ? C.VALID_ATK  :
                actionMode === 'TERRAIN' ? C.VALID_TRN  : C.VALID_MOVE;
    for (const { r, c } of validCells) {
      const { x, y } = cellToScreen(r, c);
      diamond(x, y, HW, HH);
      ctx.fillStyle = col;
      ctx.fill();
    }
  }

  function drawSelectedCell(r, c) {
    const { x, y } = cellToScreen(r, c);
    diamond(x, y, HW, HH);
    ctx.fillStyle = CONFIG.CLR.SELECTED;
    ctx.fill();
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
  }

  // ── Ghost pieces ──────────────────────────────────────────────

  function drawGhostPieces(state, viewLayer) {
    const otherLayer = viewLayer === 'surface' ? 'depth' : 'surface';
    ctx.save();
    ctx.globalAlpha = 0.18;
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        const p = state[otherLayer][r][c].piece;
        if (!p) continue;
        const { x, y } = cellToScreen(r, c);
        const def = CONFIG.PIECES[p.type];
        const gh  = pieceStandingH(def) * 0.7;
        const gw  = HW * 0.22;
        // Ghost silhouette: simple tapered body + head
        const ownerCol = p.owner === 'p1' ? CONFIG.CLR.P1 : CONFIG.CLR.P2;
        ctx.fillStyle = ownerCol;
        // Body
        ctx.beginPath();
        ctx.moveTo(x - gw * 1.1, y);
        ctx.lineTo(x + gw * 1.1, y);
        ctx.lineTo(x + gw * 0.6, y - gh);
        ctx.lineTo(x - gw * 0.6, y - gh);
        ctx.closePath();
        ctx.fill();
        // Head
        ctx.beginPath();
        ctx.arc(x, y - gh, gw * 1.3, 0, Math.PI*2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── Sort key for painter's algorithm ─────────────────────────

  function sortKey(r, c) {
    const { vr, vc } = toViewCoords(r, c);
    return vr + vc;
  }

  // ── Piece body hit test ───────────────────────────────────────
  // Returns {r,c} of the frontmost piece whose visual body contains (px,py)

  function hitTestPiece(state, layer, px, py) {
    const cells = [];
    for (let r = 0; r < BS; r++)
      for (let c = 0; c < BS; c++)
        if (state[layer][r][c].piece) cells.push({ r, c });

    // Front-to-back order (descending sortKey = frontmost first)
    cells.sort((a, b) => sortKey(b.r, b.c) - sortKey(a.r, a.c));

    for (const { r, c } of cells) {
      const { x, y } = cellToScreen(r, c);
      const def     = CONFIG.PIECES[state[layer][r][c].piece.type];
      const standH  = pieceStandingH(def);
      const hitW    = HW * 0.62;   // slightly wider than visual for forgiving tap
      if (px >= x - hitW && px <= x + hitW &&
          py >= y - standH && py <= y + HH * 0.45) {
        return { r, c };
      }
    }
    return null;
  }

  // ── Main draw call ────────────────────────────────────────────

  /**
   * @param {object} state - game state
   * @param {Map?} posOverrides - Map<pieceId, {x,y}> for animation interpolation
   * @param {Set?} flashSet - Set<pieceId> for damage flash overlay
   */
  function draw(state, posOverrides, flashSet) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const layer = state.viewLayer;
    const C     = CONFIG.CLR;

    // Base cells (skip octagonal corners)
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        if (!isValidCell(r, c)) continue;
        const even  = (r + c) % 2 === 0;
        const bgCol = layer === 'surface'
          ? (even ? C.SURFACE_EVEN : C.SURFACE_ODD)
          : (even ? C.DEPTH_EVEN   : C.DEPTH_ODD);
        drawCell(r, c, bgCol, C.GRID);
      }
    }

    drawSpecialMarkers(state, layer);

    if (state.selected && state.validCells.length > 0) {
      drawHighlights(state.validCells, state.actionMode);
    }
    if (state.selected && state.actionMode === 'MOVE' && state.attackCells?.length > 0) {
      drawHighlights(state.attackCells, 'ATTACK');
    }
    if (state.selected && state.selected.layer === layer) {
      drawSelectedCell(state.selected.r, state.selected.c);
    }

    // Sort valid cells by painter's algorithm (back→front)
    const cells = [];
    for (let r = 0; r < BS; r++)
      for (let c = 0; c < BS; c++)
        if (isValidCell(r, c)) cells.push({ r, c });
    cells.sort((a, b) => sortKey(a.r, a.c) - sortKey(b.r, b.c));

    // Draw terrain + ghost + pieces together per cell (correct overlap for tall pieces)
    for (const { r, c } of cells) {
      drawTerrain(r, c, state[layer][r][c].terrain);
    }

    drawGhostPieces(state, layer);

    for (const { r, c } of cells) {
      const p = state[layer][r][c].piece;
      if (!p) continue;
      const isSel = state.selected?.layer === layer &&
                    state.selected?.r === r &&
                    state.selected?.c === c;
      drawPiece(r, c, p, isSel, posOverrides, flashSet);
    }
  }

  // ── Public API ────────────────────────────────────────────────

  return { init, resize, draw, cellToScreen, screenToCell, setViewDir, getViewDir, loadPieceImages, hitTestPiece };
})();
