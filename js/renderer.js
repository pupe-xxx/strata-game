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
    const boardWrapper = document.getElementById('board-wrapper');
    let availW, availH;

    if (boardWrapper) {
      const rect = boardWrapper.getBoundingClientRect();
      availW = rect.width;
      availH = rect.height;
      // Mobile: board-wrapper は盤専用（message-bar非表示）のためそのまま使用
    }

    // Fallback: 未レイアウト時
    if (!availW || !availH) {
      if (isMobile) {
        availW = window.innerWidth - 8;
        availH = window.innerHeight - 44 - Math.round(window.innerHeight * 0.36) - 44;
      } else {
        // info(288) + side(240) + borders(6) = 534
        availW = window.innerWidth  - 534;
        availH = window.innerHeight - 52;
      }
    }

    // モバイルはPC向け横長キャンバスではなく盤に合わせたコンパクトサイズを使用
    const canvasW = isMobile ? 600 : CONFIG.CANVAS_W;
    const canvasH = isMobile ? 700 : CONFIG.CANVAS_H;
    const originX = isMobile ? 300 : CONFIG.ORIGIN_X;
    const originY = isMobile ? 350 : CONFIG.ORIGIN_Y;

    const scaleW = availW  / canvasW;
    const scaleH = availH  / canvasH;
    scale        = Math.max(0.28, Math.min(scaleW, scaleH, 2.5));
    canvas.width  = Math.round(canvasW * scale);
    canvas.height = Math.round(canvasH * scale);
    HEX = CONFIG.HEX_SIZE * scale;
    OX  = originX * scale;
    OY  = originY * scale;
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
    } else if (terrain.type === 'vine' && terrain.placedBy === 'p1') {
      // P2's vines are invisible to the player
      const vineCol = C.VINE_P1;
      // Background tint
      hexPath(x, y, HEX * 0.82);
      ctx.fillStyle = vineCol + '55';
      ctx.fill();
      // Border
      ctx.strokeStyle = C.VINE;
      ctx.lineWidth = 1.5 * scale;
      ctx.stroke();
      // Web lines
      ctx.strokeStyle = vineCol;
      ctx.lineWidth = 0.8 * scale;
      const r2 = HEX * 0.5;
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + r2 * Math.cos(angle), y + r2 * Math.sin(angle));
        ctx.stroke();
      }
      ctx.font = `bold ${Math.max(7, 8 * scale)}px monospace`;
      ctx.fillStyle = vineCol;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('V', x, y);
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
    // Vine-slowed indicator (green dashed ring)
    if (piece.vineSlowed) {
      ctx.beginPath();
      ctx.arc(cx, cy, pr + 3 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = CONFIG.CLR.VINE_SLOWED;
      ctx.lineWidth   = 1.8 * scale;
      ctx.setLineDash([3 * scale, 2 * scale]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Surrounded indicator (orange double ring)
    if (piece.surrounded) {
      ctx.beginPath();
      ctx.arc(cx, cy, pr + 5 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = CONFIG.CLR.SURROUNDED;
      ctx.lineWidth   = 2 * scale;
      ctx.stroke();
    }

    // Charging indicator: direction arrow + countdown badge
    if (piece.chargingSkill) {
      const { dir, turnsLeft } = piece.chargingSkill;
      // Compute direction using neighbor cellconst nRow = row + dir[0], nCol = col + dir[1];
      if (isValidCell(nRow, nCol)) {
        const { x: nx, y: ny } = cellToScreen(nRow, nCol);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (nx - cx) * 0.55, cy + (ny - cy) * 0.55);
        ctx.strokeStyle = '#ff5722';
        ctx.lineWidth   = 2 * scale;
        ctx.setLineDash([3 * scale, 2 * scale]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Countdown badge
      const bx = cx + pr * 0.75, by = cy - pr * 0.75;
      ctx.beginPath();
      ctx.arc(bx, by, 5 * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#ff5722';
      ctx.fill();
      ctx.fillStyle = 'white';
      ctx.font = `bold ${Math.max(6, 7 * scale)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(turnsLeft, bx, by);
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

    // Damage flash（拡張リング）
    if (flashSet && flashSet.has(piece.id)) {
      const expiry   = typeof flashSet.get === 'function' ? (flashSet.get(piece.id) ?? Date.now() + 900) : Date.now() + 900;
      const elapsed  = Math.max(0, 900 - (expiry - Date.now()));
      const progress = Math.min(1, elapsed / 900);
      // 拡張リング
      ctx.beginPath();
      ctx.arc(cx, cy, pr * (1.0 + progress * 1.3), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,50,50,${(1 - progress) * 0.9})`;
      ctx.lineWidth   = 3 * scale;
      ctx.stroke();
      // 内側リング（前半のみ）
      if (progress < 0.6) {
        ctx.beginPath();
        ctx.arc(cx, cy, pr * (1.0 + progress * 0.5), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,180,0,${(1 - progress / 0.6) * 0.6})`;
        ctx.lineWidth   = 1.5 * scale;
        ctx.stroke();
      }
      // 赤オーバーレイ（前半のみ）
      if (progress < 0.35) {
        ctx.globalAlpha = (0.35 - progress) / 0.35 * 0.55;
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.fillStyle = '#ff1744';
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
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
    const colMap = {
      MOVE:'VALID_MOVE', ATTACK:'VALID_ATK',
      TERRAIN:'VALID_TRN', TERRAIN_DOWN:'VALID_TRN_DOWN',
      TRANSIT:'VALID_MOVE', SKILL:'VALID_ATK',
      VINE:'VALID_VINE', REACT:'VALID_REACT', RESERVE:'VALID_RESERVE',
    };
    const fillCol = C[colMap[mode]] ?? C.VALID_MOVE;
    for (const { r, c } of cells) {
      drawHex(r, c, fillCol, null);
    }
  }

  /** Draw vine lines between P1's vine anchors (only P1 can see these) */
  function drawVineLines(state, layer) {
    if (!state.p1Vines || state.p1Vines.length < 2) return;
    const C = CONFIG.CLR;
    const lines = computeVineLines(state, 'p1');
    for (const { cells, layer: lyr } of lines) {
      if (lyr !== layer) continue;
      for (const { r, c } of cells) {
        if (!isValidCell(r, c)) continue;
        const { x, y } = cellToScreen(r, c);
        hexPath(x, y, HEX * 0.4);
        ctx.fillStyle = 'rgba(102,187,106,0.3)';
        ctx.fill();
        ctx.strokeStyle = C.VINE_P1;
        ctx.lineWidth = 1 * scale;
        ctx.setLineDash([2 * scale, 2 * scale]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /** Draw paint markers (player annotations, not game state) */
  function drawPaintMarkers(markers, layer) {
    if (!markers || markers.size === 0) return;
    const COLORS = {
      red:    'rgba(239,83,80,0.40)',
      yellow: 'rgba(255,220,0,0.40)',
      blue:   'rgba(79,195,247,0.40)',
    };
    const ICONS = { red: '⚠', yellow: '🔔', blue: 'ℹ' };
    for (const [key, color] of markers) {
      const [lyr, r, c] = key.split(',');
      if (lyr !== layer) continue;
      const ri = parseInt(r), ci = parseInt(c);
      if (!isValidCell(ri, ci)) continue;
      const { x, y } = cellToScreen(ri, ci);
      hexPath(x, y, HEX * 0.88);
      ctx.fillStyle = COLORS[color] ?? COLORS.red;
      ctx.fill();
      ctx.strokeStyle = (COLORS[color] ?? COLORS.red).replace('0.40', '0.8');
      ctx.lineWidth = 1.5 * scale;
      ctx.stroke();
      // アイコン表示
      const icon = ICONS[color] ?? '⚠';
      ctx.font = `${Math.round(HEX * 0.45 * scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(icon, x, y);
    }
  }

  /** Draw active tires on the board */
  function drawTires(state, layer) {
    if (!state.tires?.length) return;
    for (const tire of state.tires) {
      if (tire.layer !== layer) continue;
      if (!isValidCell(tire.r, tire.c)) continue;
      const { x, y } = cellToScreen(tire.r, tire.c);
      const tireCol = tire.owner === 'p1' ? CONFIG.CLR.P1 : CONFIG.CLR.P2;

      // Outer ring
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.38, 0, Math.PI * 2);
      ctx.strokeStyle = tireCol;
      ctx.lineWidth = 3.5 * scale;
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();

      // Direction arrow: point toward next step
      const nx = x + tire.dc * HEX * 0.55, ny = y + tire.dr * HEX * 0.55;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.8 * scale;
      ctx.stroke();

      // Type label
      ctx.font = `bold ${Math.max(7, 9 * scale)}px monospace`;
      ctx.fillStyle = tireCol;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tire.subtype === 'light' ? '軽' : '重', x, y);
    }
  }

  /** Draw movement paths: reserved (2-turn) AND queued normal MOVE actions */
  function drawReservedPaths(state, layer) {
    // ── 2ターン予約移動経路 ──
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        if (!isValidCell(r, c)) continue;
        const p = state[layer][r][c].piece;
        if (!p || p.owner !== 'p1' || !p.reservedMove) continue;
        const { toR, toC, viaR, viaC } = p.reservedMove;
        drawMovePath(cellToScreen(r, c), cellToScreen(toR, toC),
                     viaR != null ? cellToScreen(viaR, viaC) : null);
      }
    }

    // ── キュー済み通常MOVE経路（1ターン移動） ──
    for (const action of (state.playerActions ?? [])) {
      if (action.type !== 'MOVE' || action.fromLayer !== layer) continue;
      drawMovePath(
        cellToScreen(action.fromR, action.fromC),
        cellToScreen(action.toR,   action.toC),
        null
      );
    }
  }

  function drawMovePath(src, dst, via) {
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    if (via) ctx.lineTo(via.x, via.y);
    ctx.lineTo(dst.x, dst.y);
    ctx.strokeStyle = 'rgba(100,200,255,0.7)';
    ctx.lineWidth   = 2 * scale;
    ctx.setLineDash([4 * scale, 3 * scale]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(dst.x, dst.y, 4 * scale, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100,200,255,0.9)';
    ctx.fill();
  }

  /** Draw ZOC overlay for enemy pieces threatening p1 */
  function drawZOCOverlay(state, layer) {
    const C = CONFIG.CLR;
    const wardenZOC = new Set();
    const rangerZOC = new Set();
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        const p = state[layer][r][c].piece;
        if (!p || p.owner !== 'p2' || p.reviving) continue;
        if (p.type === 'WARDEN') {
          for (let i = 0; i < 6; i++) {
            const dr = [0,0,1,-1,1,-1][i], dc = [1,-1,0,0,-1,1][i];
            const nr = r + dr, nc = c + dc;
            if (isValidCell(nr, nc)) wardenZOC.add(`${nr},${nc}`);
          }
        } else if (p.type === 'RANGER') {
          const dirs6 = [[0,1],[0,-1],[1,0],[-1,0],[1,-1],[-1,1]];
          for (const [dr, dc] of dirs6) {
            for (let step = 1; step <= CONFIG.PIECES.RANGER.atkRange; step++) {
              const nr = r + dr * step, nc = c + dc * step;
              if (!isValidCell(nr, nc)) break;
              rangerZOC.add(`${nr},${nc}`);
              const t = state[layer][nr][nc].terrain;
              if (t.type === 'wall' && t.stage >= 2) break;
              if (state[layer][nr][nc].piece) break;
            }
          }
        }
      }
    }
    for (const key of wardenZOC) {
      const [r, c] = key.split(',').map(Number);
      drawHex(r, c, C.ZOC_W, null);
    }
    for (const key of rangerZOC) {
      const [r, c] = key.split(',').map(Number);
      if (!wardenZOC.has(key)) drawHex(r, c, C.ZOC_R, null);
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

  // ── Special markers (Echo Points only) ──────────────────────────

  function drawEchoZone(state, layer, centerR, centerC, ctrlKey, isDepth) {
    const ep   = state.echoPoint;
    const ctrl = state.occMeta?.[ctrlKey];
    const C    = CONFIG.CLR;
    const cells = echoZoneCells(centerR, centerC, layer);

    // セル塗り
    for (const { r, c } of cells) {
      let fill, stroke, sw;
      if (ctrl === 'contested') {
        fill   = 'rgba(255,152,0,0.22)';
        stroke = C.ECHO_CONT;
        sw     = 1;
      } else if (ctrl === 'p1') {
        fill   = 'rgba(79,195,247,0.28)';
        stroke = C.P1;
        sw     = (r === centerR && c === centerC) ? 2 : 1;
      } else if (ctrl === 'p2') {
        fill   = 'rgba(239,83,80,0.28)';
        stroke = C.P2;
        sw     = (r === centerR && c === centerC) ? 2 : 1;
      } else {
        fill   = 'rgba(38,198,218,0.14)';
        stroke = C.ECHO;
        sw     = 0.7;
      }
      drawHex(r, c, fill, stroke, sw);
    }

    // 中心ラベル
    const label = isDepth ? 'E深' : 'E表';
    const holdStr = (ep.holdOwner && !isDepth)
      ? ` ${ep.holdTimer}/${ep.nextScoreAt}`
      : '';
    const cycStr = isDepth ? '' : (ep.cycleExpired ? '[延]' : `[${ep.cycleTimer}T]`);
    const contLabel = ctrl === 'contested' ? '⚡' : '';
    drawMarkerRing(centerR, centerC, ctrl === 'contested' ? C.ECHO_CONT : C.ECHO,
      `${label}${contLabel}${holdStr}${cycStr}`);
  }

  function drawSpecialMarkers(state, layer) {
    const ep = state.echoPoint;
    if (!ep?.active) return;

    if (layer === 'surface' && ep.surfaceR !== null) {
      drawEchoZone(state, 'surface', ep.surfaceR, ep.surfaceC, 'echoSurface', false);
    }
    if (layer === 'depth' && ep.depthR !== null) {
      drawEchoZone(state, 'depth', ep.depthR, ep.depthC, 'echoDepth', true);
    }
  }

  // ── Main draw ────────────────────────────────────────────────────

  let _paintMarkers = null;
  function setPaintMarkers(m) { _paintMarkers = m; }

  let _reserveCells = [];
  function setReserveCells(cells) { _reserveCells = cells ?? []; }

  let _deathEffects = [];
  function setDeathEffects(effects) { _deathEffects = effects; }

  function drawDeathEffects() {
    const now = Date.now();
    for (const eff of _deathEffects) {
      if (eff.expiry < now) continue;
      const dur      = eff.expiry - eff.startTime;
      const progress = Math.min(1, (now - eff.startTime) / dur);
      const fade     = 1 - progress;
      // 外側リング
      ctx.beginPath();
      ctx.arc(eff.x, eff.y, HEX * (0.3 + progress * 1.4), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,80,0,${fade * 0.9})`;
      ctx.lineWidth   = 3 * scale;
      ctx.stroke();
      // 内側リング
      ctx.beginPath();
      ctx.arc(eff.x, eff.y, HEX * (0.2 + progress * 0.8), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,220,0,${fade * 0.7})`;
      ctx.lineWidth   = 2 * scale;
      ctx.stroke();
      // ✕クロス
      const sz = HEX * 0.28 * (1 - progress * 0.4);
      ctx.strokeStyle = `rgba(255,100,0,${fade * 0.9})`;
      ctx.lineWidth   = 2.5 * scale;
      ctx.beginPath(); ctx.moveTo(eff.x - sz, eff.y - sz); ctx.lineTo(eff.x + sz, eff.y + sz); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(eff.x + sz, eff.y - sz); ctx.lineTo(eff.x - sz, eff.y + sz); ctx.stroke();
    }
  }

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

    // 2.5 ZOC overlay + vine lines + paint markers
    drawZOCOverlay(state, layer);
    drawVineLines(state, layer);
    if (_paintMarkers) drawPaintMarkers(_paintMarkers, layer);

    // 3. Highlights
    if (state.selected && _reserveCells.length > 0 && state.actionMode === 'MOVE') {
      drawHighlights(_reserveCells, 'RESERVE');
    }
    if (state.selected && state.validCells.length > 0) {
      const hlMode = (state.actionMode === 'TERRAIN' && state.terrainDir === 'down')
        ? 'TERRAIN_DOWN' : state.actionMode;
      drawHighlights(state.validCells, hlMode);
    }
    if (state.selected && state.actionMode === 'MOVE' && state.attackCells?.length > 0) {
      drawHighlights(state.attackCells, 'ATTACK');
    }
    if (state.selected && state.selected.layer === layer) {
      drawSelectedCell(state.selected.r, state.selected.c);
    }

    // 3.5 Reserved paths + tires
    drawReservedPaths(state, layer);
    drawTires(state, layer);

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

    // 5. 死亡エフェクト
    drawDeathEffects();
  }

  return {
    init, resize, setViewDir, getViewDir,
    cellToScreen, screenToCell, hitTestPiece, draw, setPaintMarkers, setReserveCells, setDeathEffects,
  };
})();
