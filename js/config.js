// ===== STRATA — Game Configuration (Hex Grid) =====
'use strict';

const CONFIG = Object.freeze({
  // ─── Hex grid ───────────────────────────────────────────────────
  BOARD_RADIUS: 7,       // hex grid radius; valid cells: max(|q|,|r|,|s|) <= R
  BOARD_SIZE:   15,      // 2*BOARD_RADIUS + 1 (array storage)

  // Canvas dimensions (unscaled — resize() applies scale)
  CANVAS_W: 720,
  CANVAS_H: 740,

  // Hex cell radius in px (unscaled)
  HEX_SIZE: 26,

  // Canvas origin = center hex screen position
  ORIGIN_X: 360,
  ORIGIN_Y: 370,

  // ─── Piece definitions ───────────────────────────────────────────
  PIECES: {
    WARDEN:   { maxHp:3, height:2, moveDir:'hex', moveDist:2, atkRange:1, terrainRange:2 },
    SCULPTOR: { maxHp:2, height:1, moveDir:'hex', moveDist:2, atkRange:1, terrainRange:3 },
    STRIKER:  { maxHp:1, height:1, moveDir:'hex', moveDist:3, atkRange:1, terrainRange:0 },
    RANGER:   { maxHp:2, height:1, moveDir:'hex', moveDist:2, atkRange:5, terrainRange:5 },
    PHANTOM:  { maxHp:1, height:3, moveDir:'hex', moveDist:3, atkRange:1, terrainRange:0 },
    ENGINEER: { maxHp:2, height:1, moveDir:'hex', moveDist:2, atkRange:1, terrainRange:0 },
  },

  PIECE_LABEL: {
    WARDEN:'ウォーデン', SCULPTOR:'スカルプター',
    STRIKER:'ストライカー', RANGER:'レンジャー', PHANTOM:'ファントム', ENGINEER:'エンジニア',
  },
  PIECE_EMOJI:  { WARDEN:'🛡', SCULPTOR:'⛏', STRIKER:'⚡', RANGER:'🏹', PHANTOM:'👻', ENGINEER:'🔧' },
  PIECE_SYMBOL: { WARDEN:'◆', SCULPTOR:'◈', STRIKER:'▲', RANGER:'⊕', PHANTOM:'◎', ENGINEER:'⚙' },
  PIECE_COLOR:  {
    WARDEN:'#b0bec5', SCULPTOR:'#bcaaa4', STRIKER:'#ff8a65',
    RANGER:'#81c784', PHANTOM:'#ce93d8', ENGINEER:'#ffb74d',
  },

  // ─── Colours ─────────────────────────────────────────────────────
  CLR: {
    SURFACE_EVEN: '#1c2e45', SURFACE_ODD: '#152236',
    DEPTH_EVEN:   '#0d1f2d', DEPTH_ODD:   '#091620',
    GRID:         '#2a4060', GRID_BRIGHT: '#3d6090',
    P1:           '#4fc3f7', P2:          '#ef5350',
    VALID_MOVE:   'rgba(76,175,80,0.55)',
    VALID_ATK:    'rgba(244,67,54,0.55)',
    VALID_TRN:    'rgba(255,193,7,0.55)',
    SELECTED:     'rgba(255,235,59,0.60)',
    OCC_A:        '#ffd700',
    OCC_A_PRE:    'rgba(255,215,0,0.35)',
    OCC_B:        '#81c784',
    DCP:          '#ba68c8',
    WALL_1:       '#546e7a', WALL_2: '#78909c', WALL_3: '#ffd700',
    HOLE_1:       '#0d1a14', HOLE_2: '#070d0a', HOLE_3: '#ffd700',
    TRAPPED:      '#ff6f00', REVIVING: '#7b1fa2',
  },

  // ─── Area A (scoring zone) ────────────────────────────────────────
  OCC_A_NEUTRAL_R:     4,   // max axial row distance from center for spawn
  OCC_A_PREVIEW_TURNS: 3,
  OCC_A_ACTIVE_TURNS:  5,
  OCC_A_DORMANT_TURNS: 3,
  WIN_SCORE:           2,

  // ─── Area B ───────────────────────────────────────────────────────
  // Positions in array coords (row, col), center=(7,7)
  OCC_B_INIT: [
    { r:4, c:4, layer:'surface' },   // q=-3, r=-3 → max(3,3,6)=6 ≤ 7
    { r:10,c:10, layer:'depth'  },   // q=3, r=3
  ],
  B_MOVE_INTERVAL: 6,

  // ─── Deep Control Points ──────────────────────────────────────────
  DCP: [
    { r:7, c:7,  key:'alpha', label:'α', effect:'FREE_EMERGE'   },
    { r:5, c:7,  key:'beta',  label:'β', effect:'TERRAIN_BOOST' },
    { r:9, c:7,  key:'gamma', label:'γ', effect:'FAST_REVIVE'   },
  ],

  // ─── Initial piece layout for Player 1 (bottom area) ─────────────
  // Hex validity: max(|q|,|r|,|q+r|) <= 7 where q=col-7, r=row-7
  P1_LAYOUT: [
    { r:11, c:5,  type:'ENGINEER' },  // q=-2, r=4
    { r:11, c:7,  type:'RANGER'   },  // q=0,  r=4
    { r:11, c:9,  type:'RANGER'   },  // q=2,  r=4
    { r:11, c:10, type:'ENGINEER' },  // q=3,  r=4, s=-7 ✓
    { r:12, c:6,  type:'WARDEN'   },  // q=-1, r=5
    { r:12, c:7,  type:'SCULPTOR' },  // q=0,  r=5
    { r:12, c:8,  type:'WARDEN'   },  // q=1,  r=5
    { r:13, c:7,  type:'PHANTOM'  },  // q=0,  r=6
  ],

  HAND_PIECES: ['STRIKER', 'STRIKER'],
  REVIVE_WAIT: 1,
});
