// ===== STRATA — Game Configuration =====
'use strict';

const CONFIG = Object.freeze({
  BOARD_SIZE: 16,

  // Octagonal shape: cut corners where r+c < CUT or equivalent
  CORNER_CUT: 4,

  // Isometric canvas base dimensions
  CANVAS_W: 900,
  CANVAS_H: 680,

  // Isometric cell half-dimensions (px at scale 1.0)
  HW: 28,
  HH: 18,

  // Board origin: where cell(0,0) center is drawn
  ORIGIN_X: 450,
  ORIGIN_Y: 90,

  // ─── Piece definitions ───────────────────────────────────────
  // height: 1=standard, 2=large, 3=flying
  // moveDir: 'ortho' | 'all'
  // atkRange: 0 = cannot attack
  // terrainRange: 0 = cannot deform terrain
  PIECES: {
    WARDEN:   { maxHp:3, height:2, moveDir:'ortho', moveDist:2, atkRange:1, terrainRange:2 },
    SCULPTOR: { maxHp:2, height:1, moveDir:'all',   moveDist:2, atkRange:1, terrainRange:3 },
    STRIKER:  { maxHp:1, height:1, moveDir:'ortho', moveDist:3, atkRange:1, terrainRange:0 },
    RANGER:   { maxHp:2, height:1, moveDir:'ortho', moveDist:2, atkRange:5, terrainRange:5 },
    PHANTOM:  { maxHp:1, height:3, moveDir:'all',   moveDist:3, atkRange:1, terrainRange:0 },
    ENGINEER: { maxHp:2, height:1, moveDir:'ortho', moveDist:2, atkRange:1, terrainRange:0 },
  },

  PIECE_LABEL: {
    WARDEN:'ウォーデン', SCULPTOR:'スカルプター',
    STRIKER:'ストライカー', RANGER:'レンジャー', PHANTOM:'ファントム', ENGINEER:'エンジニア',
  },

  PIECE_EMOJI: {
    WARDEN:'🛡', SCULPTOR:'⛏', STRIKER:'⚡', RANGER:'🏹', PHANTOM:'👻', ENGINEER:'🔧',
  },

  PIECE_SYMBOL: {
    WARDEN:'◆', SCULPTOR:'◈', STRIKER:'▲', RANGER:'⊕', PHANTOM:'◎', ENGINEER:'⚙',
  },

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
    OCC_A_PRE:    'rgba(255,215,0,0.35)',  // preview (translucent)
    OCC_B:        '#81c784',
    DCP:          '#ba68c8',
    EMERGE:       '#4dd0e1',
    WALL_1:       '#546e7a',
    WALL_2:       '#78909c',
    WALL_3:       '#ffd700',
    HOLE_1:       '#0d1a14',
    HOLE_2:       '#070d0a',
    HOLE_3:       '#ffd700',
    TRAPPED:      '#ff6f00',
    REVIVING:     '#7b1fa2',
  },

  // ─── Area A (scoring zone) ────────────────────────────────────
  OCC_A_SIZE:          2,   // 2×2 zone
  OCC_A_PREVIEW_TURNS: 3,   // turns shown as preview before activation
  OCC_A_ACTIVE_TURNS:  5,   // turns active; point given to controller at end
  OCC_A_DORMANT_TURNS: 3,   // rest turns after scoring before next cycle
  WIN_SCORE:           2,   // first to this many points wins

  // ─── Area B (moving occupation points) ───────────────────────
  OCC_B_INIT: [
    { r:3, c:3, layer:'surface' },
    { r:10, c:10, layer:'depth' },
  ],
  B_MOVE_INTERVAL: 6,

  // ─── Deep Control Points ─────────────────────────────────────
  DCP: [
    { r:7, c:7,  key:'alpha', label:'α', effect:'FREE_EMERGE'   },
    { r:4, c:7,  key:'beta',  label:'β', effect:'TERRAIN_BOOST' },
    { r:11,c:7,  key:'gamma', label:'γ', effect:'FAST_REVIVE'   },
  ],

  // ─── Initial piece layout for Player 1 (bottom area) ─────────
  P1_LAYOUT: [
    { r:12, c:4,  type:'ENGINEER' },
    { r:12, c:6,  type:'PHANTOM'  },
    { r:12, c:9,  type:'RANGER'   },
    { r:12, c:11, type:'ENGINEER' },
    { r:13, c:5,  type:'WARDEN'   },
    { r:13, c:7,  type:'SCULPTOR' },
    { r:13, c:8,  type:'RANGER'   },
    { r:13, c:10, type:'WARDEN'   },
  ],

  HAND_PIECES: ['STRIKER', 'STRIKER'],

  REVIVE_WAIT: 1,
});
