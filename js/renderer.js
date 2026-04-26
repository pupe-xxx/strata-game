// ===== STRATA — Hex Canvas Renderer =====
'use strict';

const Renderer = (() => {
  let canvas, ctx;
  let scale = 1;
  let HEX, OX, OY;   // scaled hex radius, origin x/y
  const BS = CONFIG.BOARD_SIZE;
  const RR = CONFIG.BOARD_RADIUS;  // center index

  const pieceImages = {};
  const PIECE_SPRITE = { WARDEN: 'assets/pieces/warden.jpg' };

  function loadPieceImages() {
    for (const [type, path] of Object.entries(PIECE_SPRITE)) {
      const img = new Image();
      img.onload  = () => { pieceImages[type] = img; };
      img.onerror = () => {};
      img.src = path;
    }
  }

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');
    resize();
    loadPieceImages();
  }

  // ── Resize ───────────────────────────────────────────────────────
  function resize() {
    const isMobile = window.innerWidth <= 700;
    const sideW    = isMobile ? 0 : 185 + 195 + 24;
    const headerH  = isMobile ? 44 : 52;
    const reserveH = isMobile
      ? Math.round(window.innerHeight * 0.36) + 44
      : 80;
    const availW = window.innerWidth  - sideW - (isMobile ? 8 : 16);
    const availH = window.innerHeight - headerH - reserveH;
    const scaleW = availW  / CONFIG.CANVAS_W;
    const scaleH = availH  / CONFIG.CANVAS_H;
    scale        = Math.max(0.28, Math.min(scaleW, scaleH, 1.0));
    canvas.width  = Math.round(CONFIG.CANVAS_W * scale);
    canvas.height = Math.round(CONFIG.CANVAS_H * scale);
    HEX = CONFIG.HEX_SIZE * scale;
    OX  = CONFIG.ORIGIN_X * scale;
    OY  = CONFIG.ORIGIN_Y * scale;
  }

  // ── Hex coordinate math ──────────────────────────────────────────

  // Axial → screen (flat-top hex)
  function cellToScreen(row, col) {
    const q = col - RR;
    const r = row - RR;
    return {
      x: HEX * 1.5 * q + OX,
      y: HEX * Math.sqrt(3) * (r + q * 0.5) + OY,
    };
  }

  // Screen → axial → array indices
  function screenToCell(px, py) {
    const relX = (px - OX) / HEX;
    const relY = (py - OY) / HEX;
    const q_f  = relX * 2 / 3;
    const r_f  = (-relX / 3 + relY / Math.sqrt(3));
    const s_f  = -q_f - r_f;
    let q = Math.round(q_f), r = Math.round(r_f), s = Math.round(s_f);
    const dq = Math.abs(q - q_f), dr = Math.abs(r - r_f), ds = Math.abs(s - s_f);
    if      (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds)             r = -q - s;
    const row = r + RR, col = q + RR;
    if (isValidCell(row, col)) return { r: row, c: col };
    return null;
  }

  // Legacy compatibility: viewDir is always 0 for hex (top-down)
  function setViewDir() {}
  function getViewDir()  { return 0; }

  // ── Hex drawing primitives ───────────────────────────────────────

  function hexPath(cx, cy, radius) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else          ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawHex(row, col, fillColor, strokeColor, strokeWidth) {
    const { x, y } = cellToScreen(row, col);
    hexPath(x, y, HEX - 1.2 * scale);
    if (fillColor)  { ctx.fillStyle = fillColor;  ctx.fill(); }
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth   = (strokeWidth ?? 1) * scale;
      ctx.stroke();
    }
  }

  // ── Terrain ──────────────────────────────────────────────────────

  function drawTerrain(row, col, terrain) {
    if (terrain.type === 'flat' || terrain.stage === 0) return;
    const { x, y } = cellToScreen(row, col);
    const C = CONFIG.CLR;

    if (terrain.type === 'wall') {
      const cols = [null, C.WALL_1, C.WALL_2, C.WALL_3];
      const col_ = cols[terrain.stage] ?? C.WALL_1;
      hexPath(x, y, HEX * (0.65 + terrain.stage * 0.1));
      ctx.fillStyle = col_;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.2 * scale;
      ctx.stroke();
      // Stage indicator
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(8, 9 * scale)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`W${terrain.stage}`, x, y);
    } else if (terrain.type === 'hole') {
      const cols = [null, C.HOLE_1, C.HOLE_2, C.HOLE_3];
      const col_ = cols[terrain.stage] ?? C.HOLE_1;
      hexPath(x, y, HEX * 0.62);
      ctx.fillStyle = col_;
      ctx.fill();
      ctx.strokeStyle = '#ff6f00';
      ctx.lineWidth = 1.2 * scale;
      ctx.stroke();
      ctx.fillStyle = '#ff6f00';
      ctx.font = `bold ${Math.max(8, 9 * scale)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`H${terrain.stage}`, x, y);
    }
  }

  // ── Piece rendering (top-down circles) ───────────────────────────

  function drawPiece(row, col, piece, isSelected, posOverrides, flashSet) {
    let cx, cy;
    if (posOverrides && posOverrides.has(piece.id)) {
      const ov = posOverrides.get(piece.id);
      cx = ov.x; cy = ov.y;
    } else {
      const pos = cellToScreen(row, col);
      cx = pos.x; cy = pos.y;
    }

    const def     = CONFIG.PIECES[piece.type];
    const isP1    = piece.owner === 'p1';
    const pCol    = CONFIG.PIECE_COLOR[piece.type];
    const plrCol  = isP1 ? CONFIG.CLR.P1 : CONFIG.CLR.P2;

    // Piece radius based on height
    const pr = HEX * (0.26 + def.height * 0.05);

    // Shadow
    ctx.beginPath();
    ctx.arc(cx + 1.5 * scale, cy + 1 * scale, pr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    // Body circle
    const alpha = piece.reviving ? 0.45 : 1.0;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, pr, 0, Math.PI * 2);
    ctx.fillStyle = piece.reviving ? '#555' : pCol;
    ctx.fill();

    // Player border ring
    ctx.strokeStyle = isSelected ? '#ffe600' : plrCol;
    ctx.lineWidth   = (isSelected ? 2.5 : 1.8) * scale;
    ctx.stroke();

    // Trapped indicator
    if (piece.trapped) {
      ctx.strokeStyle = CONFIG.CLR.TRAPPED;
      ctx.lineWidth   = 2 * scale;
      ctx.stroke();
    }

    // Emoji / symbol
    const fsize = Math.max(8, Math.round(pr * 1.1));
    ctx.font = `${fsize}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = piece.reviving ? '#aaa' : '#fff';
    ctx.fillText(CONFIG.PIECE_EMOJI[piece.type] ?? CONFIG.PIECE_SYMBOL[piece.type], cx, cy);

    ctx.globalAlpha = 1.0;

    // HP dots below
    const maxHp = piece.maxHp;
    const hp    = Math.max(0, piece.hp);
    const dotR  = Math.max(2, 2.2 * scale);
    const span  = (maxHp - 1) * dotR * 2.8;
    const startX = cx - span / 2;
    const dotY   = cy + pr + dotR + 2 * scale;
    for (let i = 0; i < maxHp; i++) {
      const dx = startX + i * dotR * 2.8;
      ctx.beginPath();
      ctx.arc(dx, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = i < hp ? plrCol : '#333';
      ctx.fill();
    }

    // Damage flash
    if (flashSet && flashSet.has(piece.id)) {
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, pr * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ff1744';
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    // Selection glow
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(cx, cy, pr + 4 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,230,0,0.4)';
      ctx.lineWidth   = 4 * scale;
      ctx.stroke();
    }
  }

  // ── Hit test ─────────────────────────────────────────────────────

  function hitTestPiece(state, layer, px, py) {
    const results = [];
    for (let row = 0; row < BS; row++) {
      for (let col = 0; col < BS; col++) {
        if (!isValidCell(row, col)) continue;
        const piece = state[layer][row][col].piece;
        if (!piece) continue;
        const { x, y } = cellToScreen(row, col);
        const pr = HEX * (0.26 + CONFIG.PIECES[piece.type].height * 0.05);
        const dx = px - x, dy = py - y;
        if (dx * dx + dy * dy <= pr * pr * 2.5) {
          results.push({ r: row, c: col, dist: dx * dx + dy * dy });
        }
      }
    }
    if (results.length === 0) return null;
    results.sort((a, b) => a.dist - b.dist);
    return { r: results[0].r, c: results[0].c };
  }

  // ── Highlights ───────────────────────────────────────────────────

  function drawHighlights(cells, mode) {
    const C = CONFIG.CLR;
    const colMap = { MOVE:'VALID_MOVE', ATTACK:'VALID_ATK', TERRAIN:'VALID_TRN', TRANSIT:'VALID_MOVE', SKILL:'VALID_ATK' };
    const fillCol = C[colMap[mode]] ?? C.VALID_MOVE;
    for (const { r, c } of cells) {
      drawHex(r, c, fillCol, null);
    }
  }

  function drawSelectedCell(row, col) {
    drawHex(row, col, null, CONFIG.CLR.SELECTED, 2);
  }

  // ── Marker ring ──────────────────────────────────────────────────

  function drawMarkerRing(row, col, color, label) {
    const { x, y } = cellToScreen(row, col);
    hexPath(x, y, HEX * 0.72);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5 * scale;
    ctx.stroke();
    if (label) {
      ctx.font = `bold ${Math.max(7, 8 * scale)}px monospace`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y - HEX * 0.52);
    }
  }

  // ── Special markers (A zone, B zones, DCP) ───────────────────────

  function drawSpecialMarkers(state, layer) {
    const C = CONFIG.CLR;

    if (layer === 'surface') {
      // ── Area A Zone ──
      const zone = state.occAZone;
      if (zone && zone.r !== null && zone.phase !== 'dormant') {
        const cells = occACells(zone.r, zone.c);
        const isActive = zone.phase === 'active';
        const ctrlA = state.occMeta?.A;
        for (const pos of cells) {
          let fill, stroke;
          if (isActive && ctrlA) {
            fill   = ctrlA === 'p1' ? 'rgba(79,195,247,0.25)' : 'rgba(239,83,80,0.25)';
            stroke = ctrlA === 'p1' ? C.P1 : C.P2;
          } else if (isActive) {
            fill   = 'rgba(255,215,0,0.22)';
            stroke = C.OCC_A;
          } else {
            fill   = C.OCC_A_PRE;
            stroke = 'rgba(255,215,0,0.5)';
          }
          drawHex(pos.r, pos.c, fill, stroke, isActive ? 1.5 : 0.8);
        }
        const labelCell = cells[0];
        const lbl = isActive ? `★A残${zone.timer}` : `★A予${zone.timer}`;
        drawMarkerRing(labelCell.r, labelCell.c, isActive ? C.OCC_A : 'rgba(255,215,0,0.6)', lbl);
      }

      // ── B1 (surface) ──
      const isFlashing = Date.now() < (state.bFlashUntil ?? 0);
      state.occB.forEach((bp, i) => {
        if ((bp.layer ?? 'surface') !== 'surface') return;
        const ctrlBi = state.occMeta?.[`B${i}`];
        for (const cell of bCells(bp)) {
          if (isFlashing) {
            drawHex(cell.r, cell.c, 'rgba(129,199,132,0.45)', null);
          } else if (ctrlBi) {
            const f = ctrlBi === 'p1' ? 'rgba(79,195,247,0.2)' : 'rgba(239,83,80,0.2)';
            drawHex(cell.r, cell.c, f, null);
          }
          drawMarkerRing(cell.r, cell.c, C.OCC_B, '');
        }
        drawMarkerRing(bp.r, bp.c, C.OCC_B, `B${i + 1}`);
      });
    }

    if (layer === 'depth') {
      // DCP markers
      for (const dcp of CONFIG.DCP) {
        drawMarkerRing(dcp.r, dcp.c, C.DCP, dcp.label);
      }
      // B2 (depth)
      const isFlashing = Date.now() < (state.bFlashUntil ?? 0);
      state.occB.forEach((bp, i) => {
        if ((bp.layer ?? 'surface') !== 'depth') return;
        const ctrlBi = state.occMeta?.[`B${i}`];
        for (const cell of bCells(bp)) {
          if (isFlashing) {
            drawHex(cell.r, cell.c, 'rgba(129,199,132,0.45)', null);
          } else if (ctrlBi) {
            const f = ctrlBi === 'p1' ? 'rgba(79,195,247,0.2)' : 'rgba(239,83,80,0.2)';
            drawHex(cell.r, cell.c, f, null);
          }
          drawMarkerRing(cell.r, cell.c, CONFIG.CLR.OCC_B, '');
        }
        drawMarkerRing(bp.r, bp.c, CONFIG.CLR.OCC_B, `B${i + 1}`);
      });
    }
  }

  // ── Main draw ────────────────────────────────────────────────────

  function draw(state, posOverrides, flashSet) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const layer = state.viewLayer;
    const C     = CONFIG.CLR;

    // 1. Draw all hex cells (valid = board tile, invalid = void)
    for (let row = 0; row < BS; row++) {
      for (let col = 0; col < BS; col++) {
        if (!isValidCell(row, col)) {
          // void — draw very dark to show octagon boundary
          drawHex(row, col, '#040810', null);
          continue;
        }
        const even  = (row + col) % 2 === 0;
        const bgCol = layer === 'surface'
          ? (even ? C.SURFACE_EVEN : C.SURFACE_ODD)
          : (even ? C.DEPTH_EVEN   : C.DEPTH_ODD);
        drawHex(row, col, bgCol, C.GRID, 0.6);
      }
    }

    // 2. Special markers
    drawSpecialMarkers(state, layer);

    // 3. Highlights
    if (state.selected && state.validCells.length > 0) {
      drawHighlights(state.validCells, state.actionMode);
    }
    if (state.selected && state.actionMode === 'MOVE' && state.attackCells?.length > 0) {
      drawHighlights(state.attackCells, 'ATTACK');
    }
    if (state.selected && state.selected.layer === layer) {
      drawSelectedCell(state.selected.r, state.selected.c);
    }

    // 4. Terrain + pieces (back to front: higher row = drawn later)
    for (let row = 0; row < BS; row++) {
      for (let col = 0; col < BS; col++) {
        if (!isValidCell(row, col)) continue;
        const cell = state[layer][row][col];
        drawTerrain(row, col, cell.terrain);
      }
    }

    // Pieces (sorted back-to-front by row, then col)
    const pieceCells = [];
    for (let row = 0; row < BS; row++) {
      for (let col = 0; col < BS; col++) {
        if (!isValidCell(row, col)) continue;
        const p = state[layer][row][col].piece;
        if (p) pieceCells.push({ row, col, piece: p });
      }
    }
    pieceCells.sort((a, b) => a.row - b.row || a.col - b.col);

    for (const { row, col, piece } of pieceCells) {
      const isSel = state.selected?.layer === layer
        && state.selected.r === row && state.selected.c === col;
      drawPiece(row, col, piece, isSel, posOverrides, flashSet);
    }
  }

  return {
    init, resize, setViewDir, getViewDir,
    cellToScreen, screenToCell, hitTestPiece, draw,
  };
})();
