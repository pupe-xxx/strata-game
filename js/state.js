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
    trapped: false,       // in a hole
    reviving: false,      // waiting in depth after defeat
    reviveTimer: 0,       // turns left before piece can act
    justRevived: false,
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
    // Grids
    surface,
    depth,

    // Whose turn (p1 is human, p2 is CPU)
    turn: 1,
    phase: 'PLAYER_INPUT',   // PLAYER_INPUT | RESOLVING | GAME_OVER

    // Which layer the player is currently viewing / interacting with
    viewLayer: 'surface',

    // Pieces waiting to be deployed from hand
    p1Hand: CONFIG.HAND_PIECES.map(t => makePiece(t, 'p1')),
    p2Hand: CONFIG.HAND_PIECES.map(t => makePiece(t, 'p2')),

    // Queued actions for this turn (up to 2)
    playerActions: [],

    // Dynamic B-point positions (2×2 areas, top-left corner per point)
    occB: CONFIG.OCC_B_INIT.map(p => ({ r: p.r, c: p.c, layer: p.layer })),
    bMoveIn: CONFIG.B_MOVE_INTERVAL,  // turns until next B move
    bFlashUntil: 0,                   // timestamp: show B-move flash until this time

    // Damage flash: piece IDs damaged this turn
    damagedThisTurn: [],

    // Occupation consecutive turn counters
    occAB: { p1:0, p2:0 },   // A + any B simultaneously
    occA:  { p1:0, p2:0 },   // A alone (any)
    occMeta: {                 // last holder per square for display
      A: null, B0: null, B1: null,
    },

    // DCP control in depth
    dcpControl: { alpha:null, beta:null, gamma:null },

    // UI state
    selected: null,           // { layer, r, c } currently selected cell
    actionMode: null,         // 'MOVE'|'ATTACK'|'TERRAIN'|'DEPLOY'
    terrainDir: null,         // 'up'|'down'
    validCells: [],           // [{r,c,layer}] — move/terrain/skill targets (green)
    attackCells: [],          // [{r,c,layer}] — shown simultaneously in MOVE mode (red)

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

/** Find a piece by id, returns { layer, r, c, piece } or null */
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

/** All pieces of an owner on both layers */
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

/** Move piece physically on grid (no rule checking) */
function movePieceOnGrid(state, fromLayer, fr, fc, toLayer, tr, tc) {
  const piece = state[fromLayer][fr][fc].piece;
  state[fromLayer][fr][fc].piece = null;
  state[toLayer][tr][tc].piece = piece;
}

/** Transfer defeated piece to other layer's revival position */
function transferToRevival(state, layer, r, c) {
  const piece = state[layer][r][c].piece;
  if (!piece) return;
  state[layer][r][c].piece = null;

  const otherLayer = layer === 'surface' ? 'depth' : 'surface';
  // Find the revival row for this owner in the other layer
  // P1 revives near last row (depth), P2 near row 0
  const reviveRow  = piece.owner === 'p1' ? CONFIG.BOARD_SIZE - 1 : 0;
  const mid = Math.floor(CONFIG.BOARD_SIZE / 2);
  const reviveCols = Array.from({ length: CONFIG.BOARD_SIZE }, (_, i) => {
    const d = i >> 1;
    return i % 2 === 0 ? mid + d : mid - d;
  });

  // Find first empty cell in revival zone
  for (const col of reviveCols) {
    if (!state[otherLayer][reviveRow]?.[col]?.piece) {
      piece.reviving = true;
      piece.reviveTimer = hasDCP(state, piece.owner, 'FAST_REVIVE') ? 0 : CONFIG.REVIVE_WAIT;
      piece.trapped = false;
      piece.hp = piece.maxHp;  // restore HP on transfer
      state[otherLayer][reviveRow][col].piece = piece;
      return;
    }
  }
  // No space: permanent elimination
}

/** Tick revive timers; pieces become active when timer reaches 0 */
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
