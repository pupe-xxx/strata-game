// ===== STRATA — Main Entry Point =====
'use strict';

// ── Game state (module-level) ─────────────────────────────────────
let G;  // game state
let selectedHandPiece  = null;
let currentSkillMode   = null;
let reserveDestination = null;  // {r,c,layer} — step 1 of 2-step reserve selection
let reserveCells       = [];    // 2-turn preview cells shown in MOVE mode
const paintMarkers = new Map(); // key="layer,r,c" → 'red'|'yellow'|'blue'
const PAINT_COLORS = ['red', 'yellow', 'blue'];
let currentPaintColor  = 'red'; // 現在の選択色（右クリック/長押しで使用）

// Long-press detection for mobile paint
let _longPressTimer = null;
let _longPressStart = null;

// Damage flash: pieceId → expiry timestamp (display-only, not in state)
const damageFlash = new Map();

// ── Animation ─────────────────────────────────────────────────────
const ANIM_DURATION = 500;  // ms
// (animation state managed inside startAnimation closure)

function easeInOut(t) { return t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t; }

function snapshotPositions(state) {
  const snap = new Map();
  for (const layer of ['surface','depth']) {
    for (let r = 0; r < CONFIG.BOARD_SIZE; r++) {
      for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
        const p = state[layer][r][c].piece;
        if (p) {
          const { x, y } = Renderer.cellToScreen(r, c);
          snap.set(p.id, { r, c, layer, x, y });
        }
      }
    }
  }
  return snap;
}

function buildAnimQueue(snapshot, state) {
  const queue = [];
  for (const layer of ['surface','depth']) {
    for (let r = 0; r < CONFIG.BOARD_SIZE; r++) {
      for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
        const p = state[layer][r][c].piece;
        if (!p) continue;
        const prev = snapshot.get(p.id);
        if (!prev) continue;
        const { x: toX, y: toY } = Renderer.cellToScreen(r, c);
        if (Math.abs(prev.x - toX) > 1 || Math.abs(prev.y - toY) > 1) {
          queue.push({ pieceId: p.id, fromX: prev.x, fromY: prev.y, toX, toY });
        }
      }
    }
  }
  return queue;
}

/** 複数駒を同時にアニメーション再生 */
function animateGroup(group, onDone) {
  if (group.length === 0) { onDone(); return; }
  const start = performance.now();

  function frame(ts) {
    const raw = Math.min(1, (ts - start) / ANIM_DURATION);
    const t   = easeInOut(raw);
    const posOverrides = new Map();
    for (const entry of group) {
      posOverrides.set(entry.pieceId, {
        x: entry.fromX + (entry.toX - entry.fromX) * t,
        y: entry.fromY + (entry.toY - entry.fromY) * t,
      });
    }
    const activeFlash = damageFlash.size > 0 ? new Set(damageFlash.keys()) : null;
    Renderer.draw(G, posOverrides, activeFlash);
    if (raw < 1) {
      requestAnimationFrame(frame);
    } else {
      onDone();
    }
  }
  requestAnimationFrame(frame);
}

/** グループ配列を順番に再生（各グループは同時） */
function startAnimation(groups, onDone) {
  // groups は Array<Array<entry>> または Array<entry>（後方互換）
  const normalised = Array.isArray(groups[0]) ? groups : [groups];
  let i = 0;
  function next() {
    if (i >= normalised.length) { onDone(); return; }
    const g = normalised[i++];
    if (g.length === 0) { next(); return; }
    animateGroup(g, () => setTimeout(next, 120));
  }
  next();
}

function getSkillName(pieceType) {
  return { WARDEN:'押し出し', RANGER:'狙撃', STRIKER:'位置交換', ENGINEER:'修繕' }[pieceType] || null;
}

function canUseVine(pieceType)  { return pieceType === 'ENGINEER'; }
function canUseReact(pieceType, atkRange) { return atkRange > 0; }
function canUseRoller(pieceType) { return pieceType === 'ROLLER'; }

function isMobile() { return window.innerWidth <= 700; }


// ── Tab / panel switching ──────────────────────────────────────────
function switchInfoTab(tabName) {
  document.querySelectorAll('.info-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tabName));
  document.getElementById('tab-you-panel').style.display      = tabName === 'you'      ? '' : 'none';
  const cpuPanel = document.getElementById('tab-cpu-panel');
  if (cpuPanel) cpuPanel.style.display                        = tabName === 'cpu'      ? '' : 'none';
  document.getElementById('tab-selected-panel').style.display = tabName === 'selected' ? '' : 'none';
}

// Sync action button state to both desktop (#btn-X) and mobile (#mob-btn-X)
function setActBtn(id, opts) {
  [id, 'mob-' + id].forEach(bid => {
    const el = document.getElementById(bid);
    if (!el) return;
    if (opts.disabled !== undefined) el.disabled = opts.disabled;
    if (opts.active   !== undefined) el.classList.toggle('active', opts.active);
    if (opts.text     !== undefined) el.textContent = opts.text;
  });
}

// ── Init ──────────────────────────────────────────────────────────
function initGame() {
  G = createInitialState();
  generateEchoPoints(G);
  const ind = document.getElementById('layer-indicator');
  if (ind) { ind.textContent = '● 表層'; ind.className = 'pc-only surface'; }
  // On mobile, move controls-row to be a direct grid child of game-layout
  // so it gets its own grid row and isn't clipped by board-wrapper overflow.
  if (isMobile()) {
    const ctrl = document.getElementById('controls-row');
    const gameLayout = document.getElementById('game-layout');
    const infoPanel  = document.getElementById('info-panel');
    gameLayout.insertBefore(ctrl, infoPanel);
  }
  Renderer.init(document.getElementById('game-canvas'));
  Renderer.resize();
  bindEvents();
  tick();
}

function restartGame() {
  G = createInitialState();
  generateEchoPoints(G);
  paintMarkers.clear();
  Renderer.setPaintMarkers(paintMarkers);
  reserveDestination = null;
  clearSlots();
  hideGameOver();
  clearInfoPanel();
  addLog('ゲーム開始', 'system');
  tick();
}

// ── Main render loop ──────────────────────────────────────────────
function tick() {
  // Expire old damage flash entries
  const now = Date.now();
  for (const [id, until] of damageFlash) {
    if (now > until) damageFlash.delete(id);
  }
  const activeFlash = damageFlash.size > 0 ? new Set(damageFlash.keys()) : null;
  Renderer.draw(G, null, activeFlash);
  updateUI();
  if (G.phase !== 'GAME_OVER') {
    requestAnimationFrame(tick);
  }
}

// ── Event binding ─────────────────────────────────────────────────
function bindEvents() {
  // Canvas click / touch
  const canvas = document.getElementById('game-canvas');
  canvas.addEventListener('click',       onCanvasClick);
  canvas.addEventListener('contextmenu', onCanvasRightClick);
  canvas.addEventListener('touchstart',  onCanvasTouchStart, { passive: false });
  canvas.addEventListener('touchend',    onCanvasTouchEnd,   { passive: false });

  // Layer toggle (buttons)
  document.getElementById('btn-surface').addEventListener('click', () => setLayer('surface'));
  document.getElementById('btn-depth').addEventListener('click',   () => setLayer('depth'));

  // PC: mouse scroll on board-wrapper (canvas含む余白全体) → layer switch
  document.getElementById('board-wrapper').addEventListener('wheel', e => {
    e.preventDefault();
    if (e.deltaY < 0) setLayer('surface');
    else              setLayer('depth');
  }, { passive: false });

  // Mobile: double-tap on board-wrapper (キャンバス外の余白) で層切り替え
  let _dtTimer = null;
  const boardWrapper = document.getElementById('board-wrapper');
  if (boardWrapper) {
    boardWrapper.addEventListener('touchend', e => {
      // キャンバス・ボタン類をタップした場合は無視
      if (e.target === canvas || e.target.closest('button, .act-btn, #controls-row')) return;
      if (_dtTimer) {
        clearTimeout(_dtTimer);
        _dtTimer = null;
        setLayer(G.viewLayer === 'surface' ? 'depth' : 'surface');
      } else {
        _dtTimer = setTimeout(() => { _dtTimer = null; }, 320);
      }
    }, { passive: true });
  }

  // View buttons (no-op for hex top-down view)
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.style.display = 'none';
  });

  // Action buttons
  document.getElementById('btn-terrain') .addEventListener('click', () => setActionMode('TERRAIN'));
  document.getElementById('btn-skill')   .addEventListener('click', () => setActionMode('SKILL'));
  document.getElementById('btn-vine')    .addEventListener('click', () => setActionMode('VINE'));
  document.getElementById('btn-react')   .addEventListener('click', () => setActionMode('REACT'));
  document.getElementById('btn-pass-action').addEventListener('click', queuePass);

  // Roller menu
  document.querySelectorAll('.roller-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSkillMode = 'ROLLER_' + btn.dataset.rtype;
      document.getElementById('roller-menu').style.display = 'none';
      setActionMode('SKILL');
    });
  });
  document.getElementById('btn-roller-cancel')?.addEventListener('click', () => {
    document.getElementById('roller-menu').style.display = 'none';
    currentSkillMode = null;
    G.validCells = [];
  });


  // Layer transit
  document.getElementById('btn-transit').addEventListener('click', () => {
    if (!G.selected) return;
    if (G.playerActions.length >= 2) { setMessage('すでに2アクション設定済みです'); return; }
    const { layer, r, c } = G.selected;

    // Normal transit (same grid coordinate)
    const dest = getTransitDest(G, layer, r, c);
    if (!dest) { setMessage('層移動できません'); return; }
    const piece = getPieceAt(G, layer, r, c);
    const action = {
      owner: 'p1', type: 'TRANSIT',
      pieceId: piece.id,
      fromLayer: layer, fromR: r, fromC: c,
      toLayer: dest.layer, toR: dest.r, toC: dest.c,
    };
    G.playerActions.push(action);
    fillSlot(G.playerActions.length - 1, action, piece);
    document.getElementById('btn-confirm').disabled = false;
    G.selected = null; G.actionMode = null; G.validCells = []; G.attackCells = [];
    document.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
    setActBtn('btn-transit', { disabled: true });
    setActBtn('btn-skill',   { disabled: true });
    clearInfoPanel();
    const remaining = 2 - G.playerActions.length;
    setMessage(remaining > 0
      ? `アクション設定済み (残り${remaining}個まで設定可能)`
      : 'アクション設定完了。「ターン確定」を押してください');
  });

  // Terrain direction (desktop: data-dir, mobile: data-mob-dir)
  function applyTerrainDir(dir) {
    G.terrainDir = dir;
    document.querySelectorAll('.terrain-opt').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll(`.terrain-opt[data-dir="${dir}"], .terrain-opt[data-mob-dir="${dir}"]`)
      .forEach(b => b.classList.add('selected'));
    setActionMode('TERRAIN');
  }
  document.querySelectorAll('.terrain-opt[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => applyTerrainDir(btn.dataset.dir));
  });

  // Slot clear buttons
  document.querySelectorAll('.slot-clear').forEach(btn => {
    btn.addEventListener('click', () => clearSlot(parseInt(btn.dataset.idx)));
  });

  // Confirm
  document.getElementById('btn-confirm').addEventListener('click', confirmTurn);

  // Mobile: info tab buttons
  document.querySelectorAll('.info-tab').forEach(btn => {
    btn.addEventListener('click', () => switchInfoTab(btn.dataset.tab));
  });

  // Mobile action buttons
  document.getElementById('mob-btn-vine')   ?.addEventListener('click', () => setActionMode('VINE'));
  document.getElementById('mob-btn-react')  ?.addEventListener('click', () => setActionMode('REACT'));
  document.getElementById('mob-btn-terrain')?.addEventListener('click', () => {
    if (G.terrainDir === null) {
      document.getElementById('mob-terrain-menu').style.display = 'flex';
    } else {
      setActionMode('TERRAIN');
    }
  });
  document.getElementById('mob-btn-transit')?.addEventListener('click', () =>
    document.getElementById('btn-transit').click());
  document.getElementById('mob-btn-skill')  ?.addEventListener('click', () => setActionMode('SKILL'));
  document.getElementById('mob-btn-pass')   ?.addEventListener('click', queuePass);
  // Hide view buttons on mobile too (hex is always top-down)
  document.querySelectorAll('.view-btn').forEach(b => b.style.display = 'none');

  // Mobile terrain submenu (data-mob-dir)
  document.querySelectorAll('.terrain-opt[data-mob-dir]').forEach(btn => {
    btn.addEventListener('click', () => applyTerrainDir(btn.dataset.mobDir));
  });

  // Mobile: log popup
  document.getElementById('btn-log-popup')?.addEventListener('click', () => {
    document.getElementById('log-popup').style.display = 'flex';
  });
  document.getElementById('btn-close-log')?.addEventListener('click', () => {
    document.getElementById('log-popup').style.display = 'none';
  });
  document.getElementById('log-popup')?.addEventListener('click', e => {
    if (e.target === document.getElementById('log-popup'))
      document.getElementById('log-popup').style.display = 'none';
  });

  // Slot drag & drop (swap action order)
  let dragSrcIdx = null;
  [0, 1].forEach(idx => {
    const slot = document.getElementById(`slot-${idx}`);
    slot.addEventListener('dragstart', e => {
      dragSrcIdx = idx;
      slot.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    slot.addEventListener('dragend', () => {
      slot.classList.remove('dragging');
      document.querySelectorAll('.slot').forEach(s => s.classList.remove('drag-over'));
    });
    slot.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragSrcIdx !== idx) slot.classList.add('drag-over');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      if (dragSrcIdx === null || dragSrcIdx === idx) return;
      // Save, swap, redisplay
      const saved = [...G.playerActions];
      [saved[dragSrcIdx], saved[idx]] = [saved[idx], saved[dragSrcIdx]];
      G.playerActions = [];
      clearSlots();
      saved.filter(Boolean).forEach((a, i) => {
        G.playerActions.push(a);
        if (a.type === 'PASS') {
          const slotEl = document.getElementById(`slot-${i}`);
          slotEl.querySelector('.slot-text').textContent = 'パス';
          slotEl.classList.add('filled');
          slotEl.querySelector('.slot-clear').style.display = 'inline';
        } else {
          const loc = findPieceById(G, a.pieceId);
          if (loc) fillSlot(i, a, loc.piece);
        }
      });
      document.getElementById('btn-confirm').disabled = G.playerActions.length === 0;
      dragSrcIdx = null;
    });
  });

  // Restart
  document.getElementById('btn-restart').addEventListener('click', restartGame);

  // Resize
  window.addEventListener('resize', () => { Renderer.resize(); });
}

// ── Layer switching ───────────────────────────────────────────────
function setLayer(layer) {
  G.viewLayer = layer;
  G.selected  = null;
  G.validCells = [];
  G.actionMode = null;
  document.getElementById('btn-surface').classList.toggle('active', layer === 'surface');
  document.getElementById('btn-depth')  .classList.toggle('active', layer === 'depth');
  const ind = document.getElementById('layer-indicator');
  if (ind) {
    ind.textContent = layer === 'surface' ? '● 表層' : '● 深層';
    ind.className   = `pc-only ${layer}`;
  }
  setMessage(layer === 'surface' ? '表層を表示中（スクロールで切り替え）' : '深層を表示中（スクロールで切り替え）');
}

// ── Canvas interaction ────────────────────────────────────────────
function onCanvasTouchStart(e) {
  e.preventDefault();
  const rect  = e.target.getBoundingClientRect();
  const touch = e.changedTouches[0];
  _longPressStart = { px: touch.clientX - rect.left, py: touch.clientY - rect.top };
  _longPressTimer = setTimeout(() => {
    if (_longPressStart) {
      cyclePaintMarker(_longPressStart.px, _longPressStart.py);
      _longPressStart = null;
    }
  }, 500);
}

function onCanvasTouchEnd(e) {
  e.preventDefault();
  if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
  if (!_longPressStart) return; // was long-press, handled already
  const rect  = e.target.getBoundingClientRect();
  const touch = e.changedTouches[0];
  handleCanvasInteraction(touch.clientX - rect.left, touch.clientY - rect.top, false);
  _longPressStart = null;
}

function onCanvasClick(e) {
  const rect = e.target.getBoundingClientRect();
  handleCanvasInteraction(e.clientX - rect.left, e.clientY - rect.top, false);
}

function onCanvasRightClick(e) {
  e.preventDefault();
  const rect = e.target.getBoundingClientRect();
  cyclePaintMarker(e.clientX - rect.left, e.clientY - rect.top);
}

/** 右クリック/長押し：
 *  マーカーなし → 現在色で配置
 *  マーカーあり → 次の色にサイクル（赤→黄→青→削除） */
function cyclePaintMarker(px, py) {
  const cell = Renderer.screenToCell(px, py);
  if (!cell || !isValidCell(cell.r, cell.c)) return;
  const key = `${G.viewLayer},${cell.r},${cell.c}`;
  const cur = paintMarkers.get(key);
  if (cur === undefined) {
    // マーカーなし → 現在選択色で配置
    paintMarkers.set(key, currentPaintColor);
  } else {
    const idx  = PAINT_COLORS.indexOf(cur);
    const next = idx >= PAINT_COLORS.length - 1 ? null : PAINT_COLORS[idx + 1];
    if (next === null) paintMarkers.delete(key);
    else               paintMarkers.set(key, next);
  }
  Renderer.setPaintMarkers(paintMarkers);
}

function handleCanvasInteraction(px, py, isRightClick) {
  if (G.phase !== 'PLAYER_INPUT') return;
  // Piece body hit test first — catches clicks on tall pieces above their tile
  const cell = Renderer.hitTestPiece(G, G.viewLayer, px, py)
             ?? Renderer.screenToCell(px, py);
  if (!cell) return;

  const { r, c } = cell;
  const layer = G.viewLayer;
  const clickedPiece = getPieceAt(G, layer, r, c);

  // ── Deploy from hand mode ─────────────────────────────────────
  if (selectedHandPiece) {
    // Deploy targets are always surface — check r,c only (layer ignored)
    const isValid = G.validCells.some(v => v.r === r && v.c === c);
    if (isValid) {
      const action = {
        owner: 'p1', type: 'DEPLOY',
        pieceId: selectedHandPiece.id,
        toLayer: 'surface', toR: r, toC: c,
      };
      G.playerActions.push(action);
      fillSlot(G.playerActions.length - 1, action, selectedHandPiece);
      document.getElementById('btn-confirm').disabled = false;
      selectedHandPiece = null;
      G.actionMode = null; G.validCells = [];
      const remaining = 2 - G.playerActions.length;
      setMessage(remaining > 0
        ? `アクション設定済み (残り${remaining}個まで設定可能)`
        : 'アクション設定完了。「ターン確定」を押してください');
    } else {
      selectedHandPiece = null;
      G.actionMode = null; G.validCells = [];
      setMessage('配置をキャンセルしました');
    }
    return;
  }

  // If we're in a targeting mode, treat click as target selection
  if (G.selected && G.actionMode && G.actionMode !== null) {
    const isValid = G.validCells.some(v => v.r === r && v.c === c && v.layer === layer);
    if (isValid) {
      queueAction(r, c, layer);
      return;
    }

    // In MOVE mode: clicking a red (attack) cell queues ATTACK action instead
    if (G.actionMode === 'MOVE' && G.attackCells.length > 0) {
      const isAtk = G.attackCells.some(v => v.r === r && v.c === c && v.layer === layer);
      if (isAtk) {
        G.actionMode = 'ATTACK';
        queueAction(r, c, layer);
        return;
      }
    }

    // In MOVE mode: clicking a reserve (2-turn) cell enters RESERVE flow
    if (G.actionMode === 'MOVE' && reserveCells.length > 0) {
      const isRes = reserveCells.some(v => v.r === r && v.c === c && v.layer === layer);
      if (isRes) {
        G.actionMode = 'RESERVE';
        queueAction(r, c, layer);
        return;
      }
    }

    // Click on own piece while targeting: switch selection
    if (clickedPiece && clickedPiece.owner === 'p1' && !clickedPiece.reviving) {
      const alreadyUsed = G.playerActions.some(a => a.pieceId === clickedPiece.id);
      if (!alreadyUsed) { selectPiece(layer, r, c); return; }
    }
    // Click elsewhere: deselect
    deselect();
    return;
  }

  // Select a player piece
  if (clickedPiece && clickedPiece.owner === 'p1') {
    // Clicking the already-selected piece deselects it
    if (G.selected && G.selected.layer === layer && G.selected.r === r && G.selected.c === c) {
      deselect();
      return;
    }
    const alreadyUsed = G.playerActions.some(a => a.pieceId === clickedPiece.id);
    if (alreadyUsed) {
      setMessage('この駒はすでにアクション済みです');
      return;
    }
    selectPiece(layer, r, c);
    return;
  }

  // Click empty or enemy cell when nothing selected
  deselect();
}

// ── Piece info panel data ─────────────────────────────────────────
const PIECE_INFO = {
  WARDEN:   {
    move:    '上下左右 1マス（高さ2: 壁1段越え可）',
    attack:  '隣接4方向 射程1',
    terrain: '直線1マス 地形変形',
    skill:   '🛡 押し出し: 隣接する駒を1マス押す',
    trait:   '高さ2の重装甲。押し出しで敵を有利なマスへ誘導できる。',
  },
  SCULPTOR: {
    move:    '全8方向 1マス',
    attack:  '全8方向 射程1',
    terrain: '直線＋斜め2マス 地形変形',
    skill:   'なし',
    trait:   '地形変形の専門家。壁・穴を最大2段まで操作できる。',
  },
  STRIKER:  {
    move:    '上下左右 1〜2マス（障害物を超えられない）',
    attack:  '隣接4方向 射程1',
    terrain: '地形変形不可',
    skill:   '⚡ 位置交換: 範囲3内の任意の駒と瞬間入替',
    trait:   '高速移動と奇襲が得意。手駒として配置可能（手持ちから）。',
  },
  RANGER:   {
    move:    '上下左右 1マス',
    attack:  '直線4方向 射程3（壁・駒で遮断）',
    terrain: '直線3マス 地形変形',
    skill:   '🏹 狙撃: 直線射程5の遠距離攻撃',
    trait:   '遠距離攻撃と地形変形を両立。壁越しには撃てない。',
  },
  PHANTOM:  {
    move:    '全8方向 1〜2マス（地形・壁を無視）',
    attack:  '全方向 射程1 ＋ 同座標の異層攻撃',
    terrain: '地形変形不可',
    skill:   '自動: 占領阻止（占領マスに乗ると相手のカウント停止）',
    trait:   '高さ3の幽霊。地形効果・壁を完全無視。どのマスからでも層移動可能。',
  },
  ENGINEER: {
    move:    '全6方向 最大2マス',
    attack:  '隣接6方向 射程1',
    terrain: '地形変形不可',
    skill:   '🔧 修繕: 隣接する味方駒を1HP回復\n🌿 蔦設置: 射程3内のマスに蔦を仕込む（最大3個）',
    trait:   '支援と罠設置の専門家。蔦は敵を減速・スキル封印し、味方には射程ボーナスを与える。',
  },
  ROLLER: {
    move:    '全6方向 最大2マス',
    attack:  '隣接6方向 射程1',
    terrain: '地形変形不可',
    skill:   '🛞 軽ローラー(2T): 最初に当たった駒でストップ\n🛞 重ローラー(3T): 全ての駒を貫通',
    trait:   'チャージ後に毎ターン3マス転がるローラーを発射。壁で停止・蔦を破壊。味方にも当たるため方向に注意。',
  },
  WARDEN: {
    move:    '全6方向 最大2マス',
    attack:  '隣接6方向 射程1',
    terrain: '直線1マス 地形変形',
    skill:   '🛡 押し出し: 隣接する駒を1マス押す',
    trait:   '高さ2の重装甲。周囲6マスに威圧圏(ZOC)を形成し、敵の移動力を-1する。',
  },
};

function updateInfoPanel(piece, def, layer) {
  const info = PIECE_INFO[piece.type];
  if (!info) return;

  document.getElementById('info-empty').style.display   = 'none';
  document.getElementById('info-content').style.display = 'block';

  const emoji = CONFIG.PIECE_EMOJI[piece.type];
  const lbl   = CONFIG.PIECE_LABEL[piece.type];
  const owner = piece.owner === 'p1' ? 'あなた' : 'CPU';
  document.getElementById('info-name').textContent    = `${emoji} ${lbl}`;
  document.getElementById('info-owner').textContent   = `${owner} | ${layer === 'surface' ? '表層' : '深層'}`;
  document.getElementById('info-hp').textContent      = `HP ${piece.hp} / ${piece.maxHp}   高さ ${def.height}`;

  const trapped    = piece.trapped    ? '⚠ 穴に捕まっています' : '';
  const reviving   = piece.reviving   ? `⚠ 復活まで${piece.reviveTimer}T` : '';
  const slowed     = piece.vineSlowed ? '🌿 蔦減速（次ターン移動-1・スキル不可）' : '';
  const surrounded = piece.surrounded ? '🔴 包囲状態（移動不可）' : '';
  document.getElementById('info-status').textContent =
    [trapped, reviving, slowed, surrounded].filter(Boolean).join(' / ') || '';

  document.getElementById('info-move').textContent    = info.move;
  document.getElementById('info-attack').textContent  = info.attack;
  document.getElementById('info-terrain').textContent = info.terrain;
  document.getElementById('info-skill').textContent   = info.skill;
  document.getElementById('info-trait').textContent   = info.trait;
}

function clearInfoPanel() {
  document.getElementById('info-empty').style.display   = 'block';
  document.getElementById('info-content').style.display = 'none';
  document.body.classList.remove('piece-selected');
  if (isMobile()) {
    switchInfoTab('you');
  } else {
    document.getElementById('tab-selected-panel').style.display = 'none';
    document.getElementById('tab-you-panel').style.display      = '';
  }
}

// ── Piece selection ───────────────────────────────────────────────
function selectPiece(layer, r, c) {
  G.selected   = { layer, r, c };
  G.terrainDir = null;

  const piece = getPieceAt(G, layer, r, c);
  const def   = CONFIG.PIECES[piece.type];
  const lbl   = CONFIG.PIECE_LABEL[piece.type];

  // Enable/disable action buttons (synced to both desktop and mobile)
  setActBtn('btn-terrain', { disabled: def.terrainRange === 0 || piece.reviving });

  const canNormalTransit = !!getTransitDest(G, layer, r, c);
  setActBtn('btn-transit', { disabled: !canNormalTransit });

  const skillName = getSkillName(piece.type);
  const isRoller = canUseRoller(piece.type);
  const skillBlocked = piece.vineSlowed;
  const hasCharging = !!piece.chargingSkill;
  setActBtn('btn-skill', {
    disabled: (!skillName && !isRoller) || piece.reviving || skillBlocked || (isRoller && hasCharging),
    text: isRoller ? 'ローラー' : (skillName || 'スキル'),
  });

  // Vine (Engineer only)
  setActBtn('btn-vine',    { disabled: !canUseVine(piece.type) || piece.reviving });
  setActBtn('btn-react',   { disabled: def.atkRange === 0 || piece.reviving });

  // Show reserved move info if piece has one
  if (piece.reservedMove) {
    const rv = piece.reservedMove;
    setMessage(`${lbl}: 予約移動中 → (${rv.toR},${rv.toC})  ※次ターン自動移動`);
    return;
  }
  // Show charging info
  if (piece.chargingSkill) {
    const tn = piece.chargingSkill.subtype === 'light' ? '軽' : '重';
    setMessage(`${lbl}: 🛞${tn}ローラーチャージ中 — 残り${piece.chargingSkill.turnsLeft}T`);
  }

  // ── Auto-enter MOVE mode ─────────────────────────────────────────
  G.actionMode = 'MOVE';
  if (piece.trapped) {
    G.validCells  = [{ r, c, layer }];
    G.attackCells = [];
    reserveCells  = [];
    setMessage(`${lbl} が穴に捕まっています — 緑マスをクリックで脱出`);
  } else if (piece.reviving || piece.surrounded) {
    G.validCells  = [];
    G.attackCells = [];
    reserveCells  = [];
    setMessage(`${lbl} 選択 — ${piece.reviving ? '復活待機中' : '包囲状態（移動不可）'}`);
  } else {
    G.validCells  = getValidMoves(G, layer, r, c);
    G.attackCells = getValidAttacks(G, layer, r, c);
    reserveCells  = (piece.reservedMove) ? [] : getValidReserveMoves(G, layer, r, c);
    Renderer.setReserveCells(reserveCells);
    const zocNote = piece.vineSlowed ? ' ⚠蔦減速' : '';
    setMessage(`${lbl} 選択 — 緑:移動${G.validCells.length} 赤:攻撃${G.attackCells.length} 水:2T予約${reserveCells.length}${zocNote}`);
  }
  Renderer.setReserveCells(reserveCells);

  // Update info panel
  updateInfoPanel(piece, def, layer);
  document.body.classList.add('piece-selected');
  // PC: switch panels manually. Mobile: CSS (body.piece-selected) handles it.
  if (!isMobile()) {
    document.getElementById('tab-you-panel').style.display      = 'none';
    document.getElementById('tab-selected-panel').style.display = '';
  }
}

function selectHandPiece(piece) {
  if (G.phase !== 'PLAYER_INPUT') return;
  if (G.playerActions.length >= 2) { setMessage('すでに2アクション設定済みです'); return; }
  selectedHandPiece = piece;
  G.selected    = null;
  G.actionMode  = 'DEPLOY';
  G.validCells  = [];
  G.attackCells = [];
  G.terrainDir  = null;
  clearInfoPanel();
  // P1 deploy zone: bottom 3 hex rows (high row indices), valid hex cells only
  const deployStart = CONFIG.BOARD_SIZE - 4;
  for (let r = deployStart; r < CONFIG.BOARD_SIZE; r++) {
    for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
      if (isValidCell(r, c) && !G.surface[r][c].piece)
        G.validCells.push({ r, c, layer: 'surface' });
    }
  }
  // hand piece deployment selected
  setMessage(`${CONFIG.PIECE_LABEL[piece.type]} の配置先を選んでください (${G.validCells.length}箇所)`);
}

function deselect() {
  G.selected    = null;
  G.actionMode  = null;
  G.validCells  = [];
  G.attackCells = [];
  G.terrainDir  = null;
  selectedHandPiece  = null;
  currentSkillMode   = null;
  reserveDestination = null;
  reserveCells       = [];
  Renderer.setReserveCells([]);
  setActBtn('btn-terrain', { disabled: true, active: false });
  setActBtn('btn-transit', { disabled: true, active: false });
  setActBtn('btn-skill',   { disabled: true, active: false, text: 'スキル' });
  setActBtn('btn-vine',    { disabled: true, active: false });
  setActBtn('btn-react',   { disabled: true, active: false });
  document.getElementById('terrain-menu').style.display     = 'none';
  document.getElementById('mob-terrain-menu').style.display = 'none';
  document.getElementById('roller-menu').style.display      = 'none';
  // 地形ボタン選択状態リセット
  document.querySelectorAll('.terrain-opt').forEach(b => b.classList.remove('selected'));
  clearInfoPanel();
  setMessage('駒をクリックして選択してください');
}

// ── Action mode selection ─────────────────────────────────────────
function setActionMode(mode) {
  if (!G.selected) return;
  const { layer, r, c } = G.selected;

  // Terrain: show direction menu and keep it visible
  if (mode === 'TERRAIN') {
    document.getElementById('terrain-menu').style.display = 'flex';
    document.getElementById('mob-terrain-menu').style.display = 'flex';
    if (G.terrainDir === null) {
      // 方向未選択 → 選択待ちのまま
      G.actionMode = 'TERRAIN';
      G.validCells = [];
      return;
    }
    // 方向選択済みなら即座に計算
  }

  G.actionMode  = mode;
  G.attackCells = [];  // hide simultaneous attack highlights once a specific mode is chosen
  currentSkillMode = null;

  if (mode === 'SKILL') {
    const piece = getPieceAt(G, layer, r, c);
    if (!piece) return;
    // ROLLER: show type selection menu, then direction targets
    if (piece.type === 'ROLLER') {
      if (!currentSkillMode?.startsWith('ROLLER')) {
        document.getElementById('roller-menu').style.display = 'flex';
        return;
      }
      // Direction selection mode
      G.validCells = getValidRollerDirections(G, layer, r, c);
      const tn = currentSkillMode === 'ROLLER_LIGHT' ? '軽' : '重';
      setMessage(`🛞${tn}ローラーの発射方向を選んでください (隣接マス)`);
      document.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
      setActBtn('btn-skill', { active: true });
      return;
    }
    if (piece.type === 'WARDEN') {
      G.validCells = getValidPushTargets(G, layer, r, c);
      currentSkillMode = 'PUSH';
      setMessage(`押し出し先を選んでください (${G.validCells.length}箇所)`);
    } else if (piece.type === 'RANGER') {
      G.validCells = getValidSnipeTargets(G, layer, r, c);
      currentSkillMode = 'SNIPE';
      setMessage(`狙撃対象を選んでください (${G.validCells.length}箇所)`);
    } else if (piece.type === 'STRIKER') {
      G.validCells = getValidSwapTargets(G, layer, r, c);
      currentSkillMode = 'SWAP';
      setMessage(`交換先を選んでください (${G.validCells.length}箇所)`);
    } else if (piece.type === 'ENGINEER') {
      G.validCells = getValidRepairTargets(G, layer, r, c);
      currentSkillMode = 'REPAIR';
      setMessage(G.validCells.length > 0
        ? `修繕先を選んでください (${G.validCells.length}箇所)`
        : '隣接に回復できる味方がいません');
    }
    document.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
    setActBtn('btn-skill', { active: true });
    return;
  }

  if (mode === 'MOVE') {
    const piece = getPieceAt(G, layer, r, c);
    if (piece?.trapped) {
      G.validCells = [{ r, c, layer }];
      setMessage('選択したマスを確認して脱出します');
    } else {
      G.validCells = getValidMoves(G, layer, r, c);
      const zocNote = piece?.vineSlowed ? ' ⚠蔦減速' : piece?.surrounded ? ' ⚠包囲中' : '';
      setMessage(`移動先を選んでください (${G.validCells.length}箇所)${zocNote}`);
    }
  } else if (mode === 'ATTACK') {
    G.validCells = getValidAttacks(G, layer, r, c);
    setMessage(`攻撃対象を選んでください (${G.validCells.length}箇所)`);
  } else if (mode === 'TERRAIN') {
    G.validCells = getValidTerrainTargets(G, layer, r, c);
    const dirLabel = G.terrainDir === 'up' ? '凸（壁）' : '凹（穴）';
    setMessage(`${dirLabel} の地形変形先を選んでください (${G.validCells.length}箇所)`);
  } else if (mode === 'VINE') {
    G.validCells = getValidVineTargets(G, layer, r, c);
    const p1v = G.p1Vines.length;
    setMessage(`🌿蔦の設置先を選んでください (${G.validCells.length}箇所) 現在${p1v}/${CONFIG.VINE_MAX}本`);
    document.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
    setActBtn('btn-vine', { active: true });
    return;
  } else if (mode === 'REACT') {
    G.validCells = getValidReactTargets(G, layer, r, c);
    setMessage(`⚡反応監視するマスを選んでください — 敵がそこへ移動したら自動攻撃 (${G.validCells.length}箇所)`);
    document.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
    setActBtn('btn-react', { active: true });
    return;
  } else if (mode === 'RESERVE') {
    // Step 1: choose 2-turn destination
    reserveDestination = null;
    G.validCells = getValidReserveMoves(G, layer, r, c);
    setMessage(`🔵予約移動先を選んでください（2ターン先まで） (${G.validCells.length}箇所)`);
    document.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
    return;
  } else if (mode === 'RESERVE_VIA') {
    // Step 2: choose intermediate waypoint
    if (!reserveDestination) return;
    G.validCells = getValidReserveVia(G, layer, r, c, reserveDestination.r, reserveDestination.c);
    setMessage(`🔵経由マスを選んでください → (${reserveDestination.r},${reserveDestination.c}) (${G.validCells.length}箇所)`);
    return;
  }

  // Highlight action mode buttons
  document.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
  if (mode === 'TERRAIN') setActBtn('btn-terrain', { active: true });
}

// ── Queue action ──────────────────────────────────────────────────
function queueAction(tr, tc, tLayer) {
  if (!G.selected || !G.actionMode) return;
  if (G.playerActions.length >= 2) { setMessage('すでに2アクション設定済みです'); return; }

  const { layer, r, c } = G.selected;
  const piece = getPieceAt(G, layer, r, c);
  if (!piece) return;

  let actionType = G.actionMode;
  if (G.actionMode === 'SKILL')       actionType = 'SKILL_' + currentSkillMode;
  if (G.actionMode === 'VINE')        actionType = 'SKILL_VINE';
  if (G.actionMode === 'REACT')       actionType = 'REACT';
  if (G.actionMode === 'RESERVE') {
    // Step 1: destination selected — switch to via selection
    reserveDestination = { r: tr, c: tc, layer: tLayer ?? layer };
    G.actionMode = 'RESERVE_VIA';
    setActionMode('RESERVE_VIA');
    return;
  }
  if (G.actionMode === 'RESERVE_VIA') actionType = 'RESERVE_SET';

  const action = {
    owner: 'p1',
    type: actionType,
    pieceId: piece.id,
    fromLayer: layer, fromR: r, fromC: c,
    toLayer: tLayer ?? layer, toR: tr, toC: tc,
    terrainDir: G.terrainDir,
  };

  // Special case: escape from trap
  if (G.actionMode === 'MOVE' && piece.trapped && tr === r && tc === c) {
    action.type = 'ESCAPE';
  }

  // Reserve: store on piece directly (consumes 1 action slot, auto-moves next turn)
  if (actionType === 'RESERVE_SET' && reserveDestination) {
    piece.reservedMove = {
      toR: reserveDestination.r, toC: reserveDestination.c, toLayer: reserveDestination.layer,
      viaR: tr, viaC: tc, viaLayer: tLayer ?? layer,
    };
    action.type = 'RESERVE_SET';
    reserveDestination = null;
  }

  G.playerActions.push(action);
  fillSlot(G.playerActions.length - 1, action, piece);

  // Update confirm button
  document.getElementById('btn-confirm').disabled = false;

  // Reset selection for next action
  G.selected    = null;
  G.actionMode  = null;
  G.validCells  = [];
  G.attackCells = [];
  G.terrainDir  = null;
  document.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('terrain-menu').style.display     = 'none';
  document.getElementById('mob-terrain-menu').style.display = 'none';
  clearInfoPanel();

  const remaining = 2 - G.playerActions.length;
  setMessage(remaining > 0
    ? `アクション設定済み (残り${remaining}個まで設定可能)`
    : 'アクション設定完了。「ターン確定」を押してください'
  );
}

function queuePass() {
  if (G.playerActions.length < 2) {
    G.playerActions.push({ owner:'p1', type:'PASS' });
    const idx = G.playerActions.length - 1;
    document.getElementById(`slot-${idx}`).querySelector('.slot-text').textContent = 'パス';
    document.getElementById(`slot-${idx}`).classList.add('filled');
    document.getElementById(`slot-${idx}`).querySelector('.slot-clear').style.display = 'inline';
  }
  document.getElementById('btn-confirm').disabled = G.playerActions.length === 0;
  setMessage('パスを設定しました');
}

// ── Slot management ───────────────────────────────────────────────
function fillSlot(idx, action, piece) {
  const slotEl  = document.getElementById(`slot-${idx}`);
  const textEl  = slotEl.querySelector('.slot-text');
  const clearEl = slotEl.querySelector('.slot-clear');

  const lbl = CONFIG.PIECE_LABEL[piece.type];
  let desc = '';
  if (action.type === 'MOVE')       desc = `${lbl} → (${action.toR},${action.toC})`;
  if (action.type === 'ATTACK')     desc = `${lbl} 攻撃 (${action.toR},${action.toC})`;
  if (action.type === 'TERRAIN')    desc = `${lbl} 地形${action.terrainDir==='up'?'凸':'凹'} (${action.toR},${action.toC})`;
  if (action.type === 'ESCAPE')     desc = `${lbl} 脱出`;
  if (action.type === 'TRANSIT')    desc = `${lbl} 層移動`;
  if (action.type === 'DEPLOY')     desc = `${lbl} 配置 (${action.toR},${action.toC})`;
  if (action.type === 'SKILL_PUSH')   desc = `${lbl} 押し出し (${action.toR},${action.toC})`;
  if (action.type === 'SKILL_SNIPE')  desc = `${lbl} 狙撃 (${action.toR},${action.toC})`;
  if (action.type === 'SKILL_SWAP')   desc = `${lbl} 位置交換 (${action.toR},${action.toC})`;
  if (action.type === 'SKILL_REPAIR') desc = `${lbl} 修繕 (${action.toR},${action.toC})`;
  if (action.type === 'SKILL_VINE')          desc = `🌿蔦設置 (${action.toR},${action.toC})`;
  if (action.type === 'REACT')               desc = `⚡反応待機 (${action.toR},${action.toC})`;
  if (action.type === 'RESERVE_SET')         desc = `🔵予約移動 → (${piece.reservedMove?.toR ?? '?'},${piece.reservedMove?.toC ?? '?'})`;
  if (action.type === 'SKILL_ROLLER_LIGHT')  desc = `🛞軽ローラーチャージ`;
  if (action.type === 'SKILL_ROLLER_HEAVY')  desc = `🛞重ローラーチャージ`;

  textEl.textContent   = desc;
  slotEl.classList.add('filled');
  clearEl.style.display = 'inline';

}

function clearSlot(idx) {
  const remaining = G.playerActions.filter((_, i) => i !== idx);
  clearSlots();
  remaining.forEach((a, i) => {
    G.playerActions.push(a);
    if (a.type === 'PASS') {
      const slotEl = document.getElementById(`slot-${i}`);
      slotEl.querySelector('.slot-text').textContent = 'パス';
      slotEl.classList.add('filled');
      slotEl.querySelector('.slot-clear').style.display = 'inline';
    } else {
      const loc = findPieceById(G, a.pieceId);
      if (loc) fillSlot(i, a, loc.piece);
    }
  });
  document.getElementById('btn-confirm').disabled = G.playerActions.length === 0;
  setMessage('アクションを解除しました');
}

function clearSlots() {
  G.playerActions = [];
  for (let i = 0; i < 2; i++) {
    const slotEl = document.getElementById(`slot-${i}`);
    slotEl.querySelector('.slot-text').textContent = '未設定';
    slotEl.classList.remove('filled');
    slotEl.querySelector('.slot-clear').style.display = 'none';
    }
  document.getElementById('btn-confirm').disabled = true;
}

// ── Confirm turn ──────────────────────────────────────────────────
function confirmTurn() {
  if (G.phase !== 'PLAYER_INPUT') return;
  G.phase = 'RESOLVING';
  deselect();
  setMessage('CPU思考中…');

  setTimeout(() => {
    // Auto-add reserved moves for P1 pieces
    for (const layer of ['surface','depth']) {
      for (let r = 0; r < CONFIG.BOARD_SIZE; r++) {
        for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
          const p = G[layer][r][c].piece;
          if (p && p.owner === 'p1' && p.reservedMove) {
            const rv = p.reservedMove;
            G.playerActions.push({
              owner: 'p1', type: 'RESERVED_MOVE', pieceId: p.id,
              fromLayer: layer, fromR: r, fromC: c,
              toLayer: rv.toLayer, toR: rv.toR, toC: rv.toC,
              viaLayer: rv.viaLayer, viaR: rv.viaR, viaC: rv.viaC,
            });
          }
        }
      }
    }

    const snapshot   = snapshotPositions(G);
    const cpuActions = CpuAI.getCpuActions(G);

    // ── アクションをペアに分割（1P①+2P①、1P②+2P②） ──────────
    const p1 = G.playerActions;
    const p2 = cpuActions.map(a => ({ ...a, owner: 'p2' }));
    const pairCount = Math.max(p1.length, p2.length);
    const pairs = [];
    for (let i = 0; i < pairCount; i++) {
      const pair = [];
      if (p1[i]) pair.push(p1[i]);
      if (p2[i]) pair.push(p2[i]);
      pairs.push(pair);
    }
    const allActions = pairs.flat();

    const log = resolveActions(G, allActions);

    // ── アニメーションをペア別に分割 ─────────────────────────────
    const fullQueue = buildAnimQueue(snapshot, G);
    const pairGroups = pairs.map(pair => {
      const ids = new Set(pair.map(a => a.pieceId));
      return fullQueue.filter(e => ids.has(e.pieceId));
    });
    // スキル押し出し等で動いた駒（どのペアにも属さない）は最終グループへ
    const assigned = new Set(pairGroups.flat().map(e => e.pieceId));
    const leftover  = fullQueue.filter(e => !assigned.has(e.pieceId));
    if (leftover.length > 0) {
      if (pairGroups.length > 0) pairGroups[pairGroups.length - 1].push(...leftover);
      else pairGroups.push(leftover);
    }

    clearSlots();
    G.turn++;
    updateUI();

    const finish = () => {
      const flashUntil = Date.now() + 900;
      for (const pid of G.damagedThisTurn ?? []) damageFlash.set(pid, flashUntil);
      G.damagedThisTurn = [];

      log.forEach(msg => {
        const isP1  = msg.includes('あなた');
        const isP2  = msg.includes('CPU');
        const isSys = msg.startsWith('★') || msg.includes('ターン');
        addLog(msg, isSys ? 'system' : isP1 ? 'p1' : isP2 ? 'p2' : '');
      });

      tickReviveTimers(G);

      if (G.phase === 'GAME_OVER') {
        Renderer.draw(G);
        showGameOver(G.winner);
        return;
      }

      G.phase = 'PLAYER_INPUT';
      setMessage(`ターン ${G.turn} — 駒を選択してください`);
      document.getElementById('turn-display').textContent = `ターン ${G.turn}`;
      tick();
    };

    if (fullQueue.length > 0) {
      startAnimation(pairGroups, finish);
    } else {
      Renderer.draw(G);
      finish();
    }
  }, 200);
}

// ── UI helpers ────────────────────────────────────────────────────
function setMessage(msg) {
  G.message = msg;
  document.getElementById('message-bar').textContent = msg;
}

function updateUI() {
  // Occupation bars
  function setBar(barId, value, max) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    bar.style.width = `${Math.min(100, (value / max) * 100)}%`;
  }
  // ── スコア表示 ─────────────────────────────────────────────────
  const s1 = G.occScore?.p1 ?? 0;
  const s2 = G.occScore?.p2 ?? 0;
  const scoreEl = document.getElementById('occ-score-display');
  if (scoreEl) scoreEl.textContent = `あなた ${s1}pt  /  CPU ${s2}pt`;

  // ── エコーポイント状態 ──────────────────────────────────────────
  const ep = G.echoPoint;
  const epSEl = document.getElementById('echo-surface-count');
  const epDEl = document.getElementById('echo-depth-count');
  const epHEl = document.getElementById('echo-hold-timer');
  const epCEl = document.getElementById('echo-cycle-timer');
  if (ep?.active) {
    const sc = G.occMeta?.echoSurface;
    const dc = G.occMeta?.echoDepth;
    const ctrlLabel = v => v === 'p1' ? 'あなた' : v === 'p2' ? 'CPU' : v === 'contested' ? '⚡拮抗' : '空き';
    const ctrlColor = v => v === 'p1' ? '#4fc3f7' : v === 'p2' ? '#ef5350' : v === 'contested' ? '#ff9800' : '#888';
    if (epSEl) { epSEl.textContent = ctrlLabel(sc); epSEl.style.color = ctrlColor(sc); }
    if (epDEl) { epDEl.textContent = ctrlLabel(dc); epDEl.style.color = ctrlColor(dc); }
    if (epHEl) {
      const nxt = ep.nextScoreAt;
      epHEl.textContent = ep.holdOwner
        ? `保持: ${ep.holdTimer}/${nxt}T`
        : '保持: 未占領';
    }
    if (epCEl) epCEl.textContent = ep.cycleExpired ? 'サイクル: 延長中' : `サイクル残: ${ep.cycleTimer}T`;
  }

  // ── ターン表示更新 ─────────────────────────────────────────────
  const turnEl = document.getElementById('turn-display');
  if (turnEl) {
    const wave = Math.min(Math.ceil(G.turn / 10), 3);
    turnEl.textContent = `Wave ${wave} / ターン ${G.turn}`;
  }

  // ── 勝利警告 ───────────────────────────────────────────────────
  const warnEl = document.getElementById('victory-warn');
  if (warnEl) {
    const msgs = [];
    if (s1 >= CONFIG.WIN_SCORE - 1) msgs.push('★ あと1点で勝利！');
    if (s2 >= CONFIG.WIN_SCORE - 1) msgs.push('⚠ CPUあと1点！');
    const rem = CONFIG.MAX_TURNS - G.turn;
    if (rem <= 5 && rem > 0) msgs.push(`⏰ 残り${rem}T`);
    warnEl.textContent = msgs.join(' / ');
    warnEl.style.display = msgs.length > 0 ? 'block' : 'none';
  }

  // Piece lists
  updatePieceList('p1');
  updatePieceList('p2');
}

function buildPieceChips(containerEl, owner, includeHandClick) {
  containerEl.innerHTML = '';
  const pieces = allPieces(G, owner);
  for (const { layer, piece } of pieces) {
    const chip = document.createElement('span');
    chip.className = 'piece-chip';
    if (piece.reviving) chip.classList.add('in-depth');
    chip.textContent = `${CONFIG.PIECE_SYMBOL[piece.type]}${CONFIG.PIECE_LABEL[piece.type]} ${piece.hp}❤`;
    chip.style.borderColor = CONFIG.PIECE_COLOR[piece.type];
    chip.title = `${layer === 'depth' ? '深層' : '表層'} HP:${piece.hp}/${piece.maxHp}`;
    containerEl.appendChild(chip);
  }
}

function buildHandChips(containerEl, owner) {
  containerEl.innerHTML = '';
  const hand = owner === 'p1' ? G.p1Hand : G.p2Hand;
  for (const piece of hand) {
    const chip = document.createElement('span');
    chip.className = 'hand-chip';
    chip.textContent = `手:${CONFIG.PIECE_LABEL[piece.type]}`;
    chip.title = owner === 'p1' ? 'クリックして配置' : '配置可能な予備駒';
    if (owner === 'p1' && G.phase === 'PLAYER_INPUT') {
      chip.classList.add('clickable');
      chip.addEventListener('click', () => selectHandPiece(piece));
    }
    containerEl.appendChild(chip);
  }
}

function updatePieceList(owner) {
  // PC side-panel
  const pcPieces = document.getElementById(`${owner}-pieces`);
  if (pcPieces) buildPieceChips(pcPieces, owner);
  const pcHand = document.getElementById(`${owner}-hand`);
  if (pcHand) buildHandChips(pcHand, owner);

  // Mobile tab panels
  const mobPieces = document.getElementById(`mob-${owner}-pieces`);
  if (mobPieces) buildPieceChips(mobPieces, owner);
  const mobHand = document.getElementById(`mob-${owner}-hand`);
  if (mobHand) buildHandChips(mobHand, owner);
}

// ── Log ──────────────────────────────────────────────────────────
function addLog(msg, cls = '') {
  const className = `log-entry${cls ? ' log-'+cls : ''}`;

  // PC log in left panel
  const el = document.getElementById('log-list');
  if (el) {
    const entry = document.createElement('div');
    entry.className = className;
    entry.textContent = msg;
    el.prepend(entry);
    while (el.children.length > 60) el.removeChild(el.lastChild);
  }

  // Mobile log popup list (mirror)
  const popupEl = document.getElementById('log-popup-list');
  if (popupEl) {
    const entry = document.createElement('div');
    entry.className = className;
    entry.textContent = msg;
    popupEl.prepend(entry);
    while (popupEl.children.length > 60) popupEl.removeChild(popupEl.lastChild);
  }
}

// ── Game over ─────────────────────────────────────────────────────
function showGameOver(winner) {
  const overlay = document.getElementById('gameover-overlay');
  const title   = document.getElementById('gameover-title');
  const msg     = document.getElementById('gameover-msg');

  if (winner === 'p1') {
    title.textContent = 'VICTORY';
    title.style.color = '#4fc3f7';
    msg.textContent   = `あなたの勝利！ (${G.occScore.p1}pts vs CPU ${G.occScore.p2}pts)`;
  } else if (winner === 'p2') {
    title.textContent = 'DEFEAT';
    title.style.color = '#ef5350';
    msg.textContent   = `CPUの勝利。(CPU ${G.occScore.p2}pts vs あなた ${G.occScore.p1}pts)`;
  } else {
    title.textContent = 'DRAW';
    title.style.color = '#ffd700';
    msg.textContent   = `30T終了 — 同点 (${G.occScore.p1}pts)`;
  }
  overlay.style.display = 'flex';
}

function hideGameOver() {
  document.getElementById('gameover-overlay').style.display = 'none';
}

// ── Bootstrap ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initGame();
  addLog('STRATA 開始', 'system');
  addLog(`目標: A+B同時${CONFIG.WIN_AB}T / A単独${CONFIG.WIN_A}T`, 'system');
});
