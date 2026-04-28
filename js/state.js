// ===== STRATA — Game State =====
'use strict';

let _uid = 0;
function uid(owner, type) { return `${owner}_${type}_${++_uid}`; }

function makeCell() {
  return { terrain: { type:'flat', stage:0 }, piece:null };
}

function makeGrid() {
  return Array.from({ length: CONFIG.BOARD_SIZE }, () =>
    Array.from({ length: CONFIG.BOARD_SIZE }, makeCell)
  );
}

function makePiece(type, owner) {
  const def = CONFIG.PIECES[type];
  return {
    id: uid(owner, type),
    type,
    owner,
    hp: def.maxHp,
    maxHp: def.maxHp,
    trapped: false,
    reviving: false,
    reviveTimer: 0,
    justRevived: false,
    vineSlowed: false,     // slowed by enemy vine: -1 moveDist, skills blocked
    surrounded: false,     // surrounded by 3+ ZOC sources: cannot move
    reservedMove: null,    // {toR,toC,toLayer,viaR,viaC,viaLayer} — auto-executes next turn
    chargingSkill: null,   // {subtype:'light'|'heavy', dir:[dr,dc], turnsLeft:N}
  };
}

// ── createInitialState ────────────────────────────────────────────
function createInitialState() {
  _uid = 0;
  const surface = makeGrid();
  const depth   = makeGrid();

  // Place P1 pieces (bottom)
  for (const { r, c, type } of CONFIG.P1_LAYOUT) {
    surface[r][c].piece = makePiece(type, 'p1');
  }

  // Place P2 pieces (180° rotation of P1 layout)
  for (const { r, c, type } of CONFIG.P1_LAYOUT) {
    const pr = CONFIG.BOARD_SIZE - 1 - r;
    const pc = CONFIG.BOARD_SIZE - 1 - c;
    surface[pr][pc].piece = makePiece(type, 'p2');
  }

  return {
    surface,
    depth,

    turn: 1,
    phase: 'PLAYER_INPUT',
    viewLayer: 'surface',

    p1Hand: CONFIG.HAND_PIECES.map(t => makePiece(t, 'p1')),
    p2Hand: CONFIG.HAND_PIECES.map(t => makePiece(t, 'p2')),

    playerActions: [],

    // ── Vine tracking ─────────────────────────────────────────────
    p1Vines: [],  // [{r, c, layer}] oldest first
    p2Vines: [],

    // ── Tire (Roller) objects ──────────────────────────────────────
    tires: [],      // [{id,r,c,layer,dr,dc,subtype,owner}]
    tireCount: 0,   // monotonic ID counter

    damagedThisTurn: [],

    // ── New Area A scoring system ─────────────────────────────
    // phase: 'dormant' | 'preview' | 'active'
    occAZone: {
      phase: 'dormant',
      r: null, c: null,     // top-left of 2×2 zone (null when dormant)
      timer: CONFIG.OCC_A_DORMANT_TURNS,
    },
    occScore: { p1: 0, p2: 0 },  // first to WIN_SCORE wins

    // ── Echo Points (エコーポイント) ──────────────────────────
    echoPoint: {
      active:       false,
      surfaceR:     null, surfaceC: null,
      depthR:       null, depthC:   null,
      cycleTimer:   CONFIG.ECHO_CYCLE_TURNS,
      cycleExpired: false,
      holdTimer:    0,
      holdOwner:    null,
    },

    // ── Display metadata ──────────────────────────────────────
    occMeta: {
      A:           null,
      echoSurface: null,
      echoDepth:   null,
    },

    selected: null,
    actionMode: null,
    terrainDir: null,
    validCells: [],
    attackCells: [],

    winner: null,
    message: '駒を選択してください',
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function getCell(state, layer, r, c) {
  return state[layer]?.[r]?.[c] ?? null;
}

function getPieceAt(state, layer, r, c) {
  return state[layer]?.[r]?.[c]?.piece ?? null;
}

function findPieceById(state, id) {
  for (const layer of ['surface','depth']) {
    for (let r = 0; r < CONFIG.BOARD_SIZE; r++) {
      for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
        const p = state[layer][r][c].piece;
        if (p && p.id === id) return { layer, r, c, piece: p };
      }
    }
  }
  return null;
}

function allPieces(state, owner) {
  const result = [];
  for (const layer of ['surface','depth']) {
    for (let r = 0; r < CONFIG.BOARD_SIZE; r++) {
      for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
        const p = state[layer][r][c].piece;
        if (p && p.owner === owner) result.push({ layer, r, c, piece: p });
      }
    }
  }
  return result;
}

function movePieceOnGrid(state, fromLayer, fr, fc, toLayer, tr, tc) {
  const piece = state[fromLayer][fr][fc].piece;
  state[fromLayer][fr][fc].piece = null;
  state[toLayer][tr][tc].piece = piece;
}

function transferToRevival(state, layer, r, c) {
  const piece = state[layer][r][c].piece;
  if (!piece) return;
  state[layer][r][c].piece = null;

  const otherLayer = layer === 'surface' ? 'depth' : 'surface';
  const reviveRow  = piece.owner === 'p1' ? CONFIG.BOARD_SIZE - 1 : 0;
  const mid = Math.floor(CONFIG.BOARD_SIZE / 2);
  const reviveCols = Array.from({ length: CONFIG.BOARD_SIZE }, (_, i) => {
    const d = i >> 1;
    return i % 2 === 0 ? mid + d : mid - d;
  });

  for (const col of reviveCols) {
    if (!state[otherLayer][reviveRow]?.[col]?.piece) {
      piece.reviving = true;
      piece.reviveTimer = CONFIG.REVIVE_WAIT;
      piece.trapped = false;
      piece.hp = piece.maxHp;
      state[otherLayer][reviveRow][col].piece = piece;
      return;
    }
  }
}

function tickReviveTimers(state) {
  for (const layer of ['surface','depth']) {
    for (let r = 0; r < CONFIG.BOARD_SIZE; r++) {
      for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
        const p = state[layer][r][c].piece;
        if (p && p.reviving) {
          p.reviveTimer--;
          if (p.reviveTimer <= 0) {
            p.reviving = false;
            p.justRevived = true;
          }
        } else if (p) {
          p.justRevived = false;
        }
      }
    }
  }
}
