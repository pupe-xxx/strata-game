// ===== STRATA — Main Entry Point =====
'use strict';

// ── Game state (module-level) ─────────────────────────────────────
let G;  // game state
let selectedHandPiece = null;  // hand piece being deployed
let currentSkillMode  = null;  // 'PUSH' | 'SNIPE' | 'SWAP' | 'REPAIR'

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
  canvas.addEventListener('click',     onCanvasClick);
  canvas.addEventListener('touchend',  onCanvasTouch, { passive: false });

  // Layer toggle
  document.getElementById('btn-surface').addEventListener('click', () => setLayer('surface'));
  document.getElementById('btn-depth').addEventListener('click',   () => setLayer('depth'));

  // View buttons (no-op for hex top-down view)
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.style.display = 'none';
  });

  // Action buttons
  document.getElementById('btn-move')    .addEventListener('click', () => setActionMode('MOVE'));
  document.getElementById('btn-attack')  .addEventListener('click', () => setActionMode('ATTACK'));
  document.getElementById('btn-terrain') .addEventListener('click', () => setActionMode('TERRAIN'));
  document.getElementById('btn-skill')   .addEventListener('click', () => setActionMode('SKILL'));
  document.getElementById('btn-pass-action').addEventListener('click', queuePass);

  // Layer transit
  document.getElementById('btn-transit').addEventListener('click', () => {
    if (!G.selected) return;
    if (G.playerActions.length >= 2) { setMessage('すでに2アクション設定済みです'); return; }
    const { layer, r, c } = G.selected;

    // α DCP FREE_EMERGE: depth→surface with arbitrary destination
    if (layer === 'depth' && hasDCP(G, 'p1', 'FREE_EMERGE')) {
      // Switch view to surface so player can see destination highlights
      G.viewLayer = 'surface';
      document.getElementById('btn-surface').classList.add('active');
      document.getElementById('btn-depth').classList.remove('active');
      // Keep selection and enter TRANSIT targeting mode
      G.selected = { layer: 'depth', r, c };
      G.actionMode = 'TRANSIT';
      G.validCells = [];
      for (let tr = 0; tr < CONFIG.BOARD_SIZE; tr++) {
        for (let tc = 0; tc < CONFIG.BOARD_SIZE; tc++) {
          if (!G.surface[tr][tc].piece)
            G.validCells.push({ r: tr, c: tc, layer: 'surface' });
        }
      }
      document.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
      setActBtn('btn-transit', { active: true });
      setMessage(`α DCP 任意浮上 — 表層の移動先をクリック (${G.validCells.length}箇所)`);
      return;
    }

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

  // Terrain direction
  document.querySelectorAll('.terrain-opt[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      G.terrainDir = btn.dataset.dir;
      document.getElementById('terrain-menu').style.display = 'none';
      setActionMode('TERRAIN');
    });
  });
  document.getElementById('btn-terrain-cancel').addEventListener('click', () => {
    document.getElementById('terrain-menu').style.display = 'none';
    G.actionMode = null;
    G.terrainDir = null;
    G.validCells = [];
  });

  // Slot clear buttons
  document.querySelectorAll('.slot-clear').forEach(btn => {
    btn.addEventListener('click', () => clearSlot(parseInt(btn.dataset.idx)));
  });

  // Confirm / deselect
  document.getElementById('btn-confirm') .addEventListener('click', confirmTurn);
  document.getElementById('btn-deselect').addEventListener('click', deselect);

  // Mobile: info tab buttons
  document.querySelectorAll('.info-tab').forEach(btn => {
    btn.addEventListener('click', () => switchInfoTab(btn.dataset.tab));
  });

  // Mobile action buttons
  document.getElementById('mob-btn-move')   ?.addEventListener('click', () => setActionMode('MOVE'));
  document.getElementById('mob-btn-attack') ?.addEventListener('click', () => setActionMode('ATTACK'));
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

  // Mobile terrain submenu
  document.querySelectorAll('.terrain-opt[data-mob-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      G.terrainDir = btn.dataset.mobDir;
      document.getElementById('mob-terrain-menu').style.display = 'none';
      setActionMode('TERRAIN');
    });
  });
  document.getElementById('mob-btn-terrain-cancel')?.addEventListener('click', () => {
    document.getElementById('mob-terrain-menu').style.display = 'none';
    G.actionMode = null;
    G.terrainDir = null;
    G.validCells = [];
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
  setMessage(layer === 'surface' ? '表層を表示中' : '深層を表示中');
}

// ── Canvas interaction ────────────────────────────────────────────
function onCanvasTouch(e) {
  e.preventDefault();
  const rect  = e.target.getBoundingClientRect();
  const touch = e.changedTouches[0];
  handleCanvasInteraction(touch.clientX - rect.left, touch.clientY - rect.top);
}

function onCanvasClick(e) {
  const rect = e.target.getBoundingClientRect();
  handleCanvasInteraction(e.clientX - rect.left, e.clientY - rect.top);
}

function handleCanvasInteraction(px, py) {
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

  // α DCP FREE_EMERGE TRANSIT: layer-independent surface targeting
  if (G.selected && G.actionMode === 'TRANSIT') {
    const isValid = G.validCells.some(v => v.r === r && v.c === c);
    if (isValid) {
      queueAction(r, c, 'surface');
      return;
    }
    // Click elsewhere: stay in targeting mode
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
    move:    '上下左右 1マス',
    attack:  '隣接4方向 射程1',
    terrain: '地形変形不可',
    skill:   '🔧 修繕: 隣接する味方駒を1HP回復（最大HPまで）',
    trait:   '支援特化。ピンチの味方を回復して戦線を維持する。HP満タンの駒には使用不可。',
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

  const trapped  = piece.trapped  ? ' ⚠ 穴に捕まっています' : '';
  const reviving = piece.reviving ? ` ⚠ 復活まで${piece.reviveTimer}T` : '';
  document.getElementById('info-status').textContent = trapped || reviving || '';

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
  setActBtn('btn-move',    { disabled: piece.reviving });
  setActBtn('btn-attack',  { disabled: def.atkRange === 0 || piece.reviving });
  setActBtn('btn-terrain', { disabled: def.terrainRange === 0 || piece.reviving });

  const canNormalTransit = !!getTransitDest(G, layer, r, c);
  const canFreeEmerge   = layer === 'depth' && hasDCP(G, 'p1', 'FREE_EMERGE');
  setActBtn('btn-transit', { disabled: !canNormalTransit && !canFreeEmerge });

  const skillName = getSkillName(piece.type);
  setActBtn('btn-skill', { disabled: !skillName || piece.reviving, text: skillName || 'スキル' });

  // ── Auto-enter MOVE mode ─────────────────────────────────────────
  G.actionMode = 'MOVE';
  if (piece.trapped) {
    G.validCells  = [{ r, c, layer }];
    G.attackCells = [];
    setActBtn('btn-move', { text: '脱出' });
    setMessage(`${lbl} が穴に捕まっています — 緑マスをクリックで脱出`);
  } else {
    G.validCells  = getValidMoves(G, layer, r, c);
    G.attackCells = getValidAttacks(G, layer, r, c);
    setActBtn('btn-move', { text: '移動' });
    setMessage(`${lbl} 選択 — 緑: 移動${G.validCells.length}  赤: 攻撃${G.attackCells.length}  ボタンで他アクション`);
  }

  document.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
  setActBtn('btn-move', { active: true });

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
  selectedHandPiece = null;
  currentSkillMode  = null;
  setActBtn('btn-move',    { disabled: true, active: false, text: '移動' });
  setActBtn('btn-attack',  { disabled: true, active: false });
  setActBtn('btn-terrain', { disabled: true, active: false });
  setActBtn('btn-transit', { disabled: true, active: false });
  setActBtn('btn-skill',   { disabled: true, active: false, text: 'スキル' });
  document.getElementById('terrain-menu').style.display     = 'none';
  document.getElementById('mob-terrain-menu').style.display = 'none';
  clearInfoPanel();
  setMessage('駒をクリックして選択してください');
}

// ── Action mode selection ─────────────────────────────────────────
function setActionMode(mode) {
  if (!G.selected) return;
  const { layer, r, c } = G.selected;

  // Terrain: need to know direction first
  if (mode === 'TERRAIN' && G.terrainDir === null) {
    document.getElementById('terrain-menu').style.display = 'flex';
    return;
  }

  G.actionMode  = mode;
  G.attackCells = [];  // hide simultaneous attack highlights once a specific mode is chosen
  currentSkillMode = null;
  document.getElementById('terrain-menu').style.display = 'none';

  if (mode === 'SKILL') {
    const piece = getPieceAt(G, layer, r, c);
    if (!piece) return;
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
      // Escape: show escape in place as valid "move"
      G.validCells = [{ r, c, layer }];
      setMessage('選択したマスを確認して脱出します');
    } else {
      G.validCells = getValidMoves(G, layer, r, c);
      setMessage(`移動先を選んでください (${G.validCells.length}箇所)`);
    }
  } else if (mode === 'ATTACK') {
    G.validCells = getValidAttacks(G, layer, r, c);
    setMessage(`攻撃対象を選んでください (${G.validCells.length}箇所)`);
  } else if (mode === 'TERRAIN') {
    G.validCells = getValidTerrainTargets(G, layer, r, c);
    const dirLabel = G.terrainDir === 'up' ? '凸（壁）' : '凹（穴）';
    setMessage(`${dirLabel} の地形変形先を選んでください (${G.validCells.length}箇所)`);
  }

  // Highlight action mode buttons
  document.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
  const activeId = mode === 'MOVE' ? 'btn-move' : mode === 'ATTACK' ? 'btn-attack' : 'btn-terrain';
  setActBtn(activeId, { active: true });
}

// ── Queue action ──────────────────────────────────────────────────
function queueAction(tr, tc, tLayer) {
  if (!G.selected || !G.actionMode) return;
  if (G.playerActions.length >= 2) { setMessage('すでに2アクション設定済みです'); return; }

  const { layer, r, c } = G.selected;
  const piece = getPieceAt(G, layer, r, c);
  if (!piece) return;

  let actionType = G.actionMode;
  if (G.actionMode === 'SKILL') actionType = 'SKILL_' + currentSkillMode;

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

  textEl.textContent   = desc;
  slotEl.classList.add('filled');
  clearEl.style.display = 'inline';

  // スマホヘッダーのスロット表示も更新
  const mobEl = document.getElementById(`mob-slot-${idx}`);
  if (mobEl) {
    mobEl.textContent = `${idx === 0 ? '①' : '②'} ${desc}`;
    mobEl.classList.add('filled');
  }
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
    // スマホヘッダーのスロット表示もリセット
    const mobEl = document.getElementById(`mob-slot-${i}`);
    if (mobEl) {
      mobEl.textContent = `${i === 0 ? '①' : '②'} 未設定`;
      mobEl.classList.remove('filled');
    }
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

  // ── Area Aゾーン状態 ───────────────────────────────────────────
  const zone = G.occAZone;
  const zoneEl = document.getElementById('occ-A-status');
  if (zoneEl && zone) {
    if (zone.phase === 'dormant') {
      zoneEl.textContent = `休止中 (${zone.timer}T後に予告)`;
      zoneEl.className = 'occ-a-status dormant';
    } else if (zone.phase === 'preview') {
      zoneEl.textContent = `★ 予告！ ${zone.timer}T後に出現`;
      zoneEl.className = 'occ-a-status preview';
    } else if (zone.phase === 'active') {
      const ctrl = G.occMeta?.A;
      const who  = ctrl === 'p1' ? 'あなたが制圧中' : ctrl === 'p2' ? 'CPUが制圧中' : '未制圧';
      zoneEl.textContent = `★ 占領チャンス！ 残り${zone.timer}T  ${who}`;
      zoneEl.className = `occ-a-status active ${ctrl ?? ''}`;
    }
  }

  // ── B1/B2 制圧者 ───────────────────────────────────────────────
  const b0ctrl = G.occMeta?.B0;
  setBar('occ-B0-p1-bar', b0ctrl === 'p1' ? 1 : 0, 1);
  setBar('occ-B0-p2-bar', b0ctrl === 'p2' ? 1 : 0, 1);
  document.getElementById('occ-B0-count').textContent =
    b0ctrl === 'p1' ? 'あなた' : b0ctrl === 'p2' ? 'CPU' : '—';

  const b1ctrl = G.occMeta?.B1;
  setBar('occ-B1-p1-bar', b1ctrl === 'p1' ? 1 : 0, 1);
  setBar('occ-B1-p2-bar', b1ctrl === 'p2' ? 1 : 0, 1);
  document.getElementById('occ-B1-count').textContent =
    b1ctrl === 'p1' ? 'あなた' : b1ctrl === 'p2' ? 'CPU' : '—';

  document.getElementById('b-move-timer').textContent = `B移動: ${G.bMoveIn}T後`;

  // ── DCP状態 ────────────────────────────────────────────────────
  for (const dcp of CONFIG.DCP) {
    const ctrl = G.dcpControl[dcp.key];
    const el = document.getElementById(`dcp-${dcp.key}`);
    if (!el) continue;
    el.textContent = ctrl === 'p1' ? 'あなた' : ctrl === 'p2' ? 'CPU' : '—';
    el.style.color = ctrl === 'p1' ? '#4fc3f7' : ctrl === 'p2' ? '#ef5350' : '#888';
  }

  // ── 勝利警告 ───────────────────────────────────────────────────
  const warnEl = document.getElementById('victory-warn');
  if (warnEl) {
    const msgs = [];
    if (s1 >= CONFIG.WIN_SCORE - 1) msgs.push('★ あと1点で勝利！');
    if (s2 >= CONFIG.WIN_SCORE - 1) msgs.push('⚠ CPUあと1点！');
    if (zone?.phase === 'active' && zone.timer <= 2) msgs.push(`★ Aゾーン判定まで${zone.timer}T!`);
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
    msg.textContent   = 'あなたの勝利です！占領目標を達成しました。';
  } else {
    title.textContent = 'DEFEAT';
    title.style.color = '#ef5350';
    msg.textContent   = 'CPUの勝利です。再挑戦しますか？';
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
