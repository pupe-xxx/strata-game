// ===== STRATA — Game Configuration =====
'use strict';

const CONFIG = Object.freeze({
  BOARD_SIZE: 11,

  // Isometric canvas base dimensions
  CANVAS_W: 780,
  CANVAS_H: 600,

  // Isometric cell half-dimensions (px at scale 1.0)
  // Larger cells to fill canvas on 11×11
  HW: 36,
  HH: 24,

  // Board origin: where cell(0,0) center is drawn
  ORIGIN_X: 390,
  ORIGIN_Y: 100,

  // ─── Piece definitions ───────────────────────────────────────
  // height: 1=standard, 2=large, 3=flying
  // moveDir: 'ortho' | 'all'
  // atkRange: 0 = cannot attack
  // terrainRange: 0 = cannot deform terrain
  PIECES: {
    // ── Active pieces ──
    WARDEN:   { maxHp:3, height:2, moveDir:'ortho', moveDist:1, atkRange:1, terrainRange:1 },
    SCULPTOR: { maxHp:2, height:1, moveDir:'all',   moveDist:1, atkRange:1, terrainRange:2 },
    STRIKER:  { maxHp:1, height:1, moveDir:'ortho', moveDist:2, atkRange:1, terrainRange:0 },
    RANGER:   { maxHp:2, height:1, moveDir:'ortho', moveDist:1, atkRange:3, terrainRange:3 },
    PHANTOM:  { maxHp:1, height:3, moveDir:'all',   moveDist:2, atkRange:1, terrainRange:0 },
    ENGINEER: { maxHp:2, height:1, moveDir:'ortho', moveDist:1, atkRange:1, terrainRange:0 },

    // ── ARCHIVED — removed from play, reserved for future use ──
    // CORE: { maxHp:2, height:1, moveDir:'all', moveDist:1, atkRange:0, terrainRange:0 },
    //   削除理由: 特定の役割がなく冗長。勝利条件との連動も廃止。

    // ── FUTURE — design pending ──
    // (新しい駒をここに追加していく)
  },

  PIECE_LABEL: {
    WARDEN:'ウォーデン', SCULPTOR:'スカルプター',
    STRIKER:'ストライカー', RANGER:'レンジャー', PHANTOM:'ファントム', ENGINEER:'エンジニア',
  },

  PIECE_EMOJI: {
    WARDEN:'🛡', SCULPTOR:'⛏', STRIKER:'⚡', RANGER:'🏹', PHANTOM:'👻', ENGINEER:'🔧',
  },

  // Fallback symbol for rendering environments that don't support emoji
  PIECE_SYMBOL: {
    WARDEN:'◆', SCULPTOR:'◈', STRIKER:'▲', RANGER:'⊕', PHANTOM:'◎', ENGINEER:'⚙',
  },

  // Base colour of each piece type
  PIECE_COLOR: {
    WARDEN:'#b0bec5', SCULPTOR:'#bcaaa4',
    STRIKER:'#ff8a65', RANGER:'#81c784', PHANTOM:'#ce93d8', ENGINEER:'#ffb74d',
  },

  // ─── Colours ─────────────────────────────────────────────────
  CLR: {
    SURFACE_EVEN: '#1c2e45',
    SURFACE_ODD:  '#152236',
    DEPTH_EVEN:   '#0d1f2d',
    DEPTH_ODD:    '#091620',
    GRID:         '#2a4060',
    GRID_BRIGHT:  '#3d6090',
    P1:           '#4fc3f7',
    P2:           '#ef5350',
    VALID_MOVE:   'rgba(76,175,80,0.55)',
    VALID_ATK:    'rgba(244,67,54,0.55)',
    VALID_TRN:    'rgba(255,193,7,0.55)',
    SELECTED:     'rgba(255,235,59,0.60)',
    OCC_A:        '#ffd700',
    OCC_B:        '#81c784',
    DCP:          '#ba68c8',
    EMERGE:       '#4dd0e1',
    WALL_1:       '#546e7a',
    WALL_2:       '#78909c',
    WALL_3:       '#ffd700',  // gate
    HOLE_1:       '#0d1a14',
    HOLE_2:       '#070d0a',
    HOLE_3:       '#ffd700',  // gate
    TRAPPED:      '#ff6f00',
    REVIVING:     '#7b1fa2',
  },

  // ─── Board special squares ────────────────────────────────────
  // OCC_A: 3×2 横長エリア（cols 4-6, rows 4-5）。過半数(4以上/6)で制圧
  OCC_A: [
    { r:4,c:4 }, { r:4,c:5 }, { r:4,c:6 },
    { r:5,c:4 }, { r:5,c:5 }, { r:5,c:6 },
  ],
  // OCC_B: B1は表層、B2は深層。state.occB に左上座標を動的管理。初期値のみ定義
  OCC_B_INIT: [{ r:1, c:1, layer:'surface' }, { r:7, c:7, layer:'depth' }],
  // Bポイントが何ターンごとに移動するか
  B_MOVE_INTERVAL: 5,
  // EMERGE ポイントは廃止。どのマスからでも層移動可能
  DCP:    [
    { r:5,c:5, key:'alpha', label:'α', effect:'FREE_EMERGE'   },
    { r:2,c:5, key:'beta',  label:'β', effect:'TERRAIN_BOOST' },
    { r:8,c:5, key:'gamma', label:'γ', effect:'FAST_REVIVE'   },
  ],

  // ─── Initial piece layout for Player 1 (bottom rows) ─────────
  P1_LAYOUT: [
    { r:10,c:1, type:'ENGINEER' }, { r:10,c:4, type:'RANGER'   },
    { r:10,c:6, type:'RANGER'   }, { r:10,c:9, type:'ENGINEER' },
    { r:9, c:2, type:'WARDEN'   }, { r:9, c:5, type:'SCULPTOR' },
    { r:9, c:8, type:'WARDEN'   }, { r:8, c:5, type:'PHANTOM'  },
  ],

  // P2 layout = 180° rotation of P1 layout (r → BS-r, c → BS-c, BS=12)

  // Starting hand pieces
  HAND_PIECES: ['STRIKER','STRIKER'],

  // ─── Victory thresholds ───────────────────────────────────────
  WIN_AB: 5,   // turns holding A + any B simultaneously
  WIN_A:  8,   // turns holding A alone

  // ─── Revival ─────────────────────────────────────────────────
  REVIVE_WAIT: 1,  // turns to wait in depth before acting

  // ─── Terrain change effects ───────────────────────────────────
  // stage 1 or 2 hole: piece is trapped (needs major action to escape)
  // stage 3: layer gate (piece can transit layers via minor action)
});
