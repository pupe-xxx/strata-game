// ===== STRATA — Game Configuration (Hex Grid) =====
'use strict';

const CONFIG = Object.freeze({
  // ─── Hex grid ───────────────────────────────────────────────────
  BOARD_RADIUS: 7,       // hex grid radius; valid cells: max(|q|,|r|,|s|) <= R
  BOARD_SIZE:   15,      // 2*BOARD_RADIUS + 1 (array storage)

  // Canvas dimensions (unscaled — resize() applies scale)
  // CANVAS_W > CANVAS_H で盤を左寄せ（右パネル分の空白をキャンバス右側に確保）
  CANVAS_W: 1110,
  CANVAS_H: 740,

  // Hex cell radius in px (unscaled)
  HEX_SIZE: 26,

  // Canvas origin = center hex screen position
  ORIGIN_X: 379,
  ORIGIN_Y: 370,

  // ─── Piece definitions ───────────────────────────────────────────
  PIECES: {
    WARDEN:   { maxHp:3, height:2, moveDir:'hex', moveDist:2, atkRange:1, terrainRange:2 },
    SCULPTOR: { maxHp:2, height:1, moveDir:'hex', moveDist:2, atkRange:1, terrainRange:3 },
    STRIKER:  { maxHp:1, height:1, moveDir:'hex', moveDist:3, atkRange:1, terrainRange:0 },
    RANGER:   { maxHp:2, height:1, moveDir:'hex', moveDist:2, atkRange:5, terrainRange:5 },
    PHANTOM:  { maxHp:1, height:3, moveDir:'hex', moveDist:3, atkRange:1, terrainRange:0 },
    ENGINEER: { maxHp:2, height:1, moveDir:'hex', moveDist:2, atkRange:1, terrainRange:0 },
    ROLLER:   { maxHp:2, height:1, moveDir:'hex', moveDist:2, atkRange:1, terrainRange:0 },
  },

  PIECE_LABEL: {
    WARDEN:'ウォーデン', SCULPTOR:'スカルプター',
    STRIKER:'ストライカー', RANGER:'レンジャー', PHANTOM:'ファントム',
    ENGINEER:'エンジニア', ROLLER:'転師',
  },
  PIECE_EMOJI:  { WARDEN:'🛡', SCULPTOR:'⛏', STRIKER:'⚡', RANGER:'🏹', PHANTOM:'👻', ENGINEER:'🔧', ROLLER:'🛞' },
  PIECE_SYMBOL: { WARDEN:'◆', SCULPTOR:'◈', STRIKER:'▲', RANGER:'⊕', PHANTOM:'◎', ENGINEER:'⚙', ROLLER:'⊗' },
  PIECE_COLOR:  {
    WARDEN:'#b0bec5', SCULPTOR:'#bcaaa4', STRIKER:'#ff8a65',
    RANGER:'#81c784', PHANTOM:'#ce93d8', ENGINEER:'#ffb74d', ROLLER:'#ff7043',
  },

  // ─── Colours ─────────────────────────────────────────────────────
  CLR: {
    SURFACE_EVEN: '#1c2e45', SURFACE_ODD: '#152236',
    DEPTH_EVEN:   '#0d1f2d', DEPTH_ODD:   '#091620',
    GRID:         '#2a4060', GRID_BRIGHT: '#3d6090',
    P1:           '#4fc3f7', P2:          '#ef5350',
    VALID_MOVE:     'rgba(76,175,80,0.55)',
    VALID_ATK:      'rgba(244,67,54,0.55)',
    VALID_TRN:      'rgba(255,193,7,0.55)',      // 凸（壁）: 黄
    VALID_TRN_DOWN: 'rgba(101,67,33,0.72)',       // 凹（穴）: 濃い茶
    VALID_VINE:     'rgba(102,187,106,0.65)',
    VALID_REACT:    'rgba(171,71,188,0.55)',
    VALID_RESERVE:  'rgba(79,195,247,0.30)',
    SELECTED:     'rgba(255,235,59,0.60)',
    ECHO:         '#26c6da',
    ECHO_CONT:    'rgba(255,152,0,0.55)',
    WALL_1:       '#546e7a', WALL_2: '#78909c', WALL_3: '#ffd700',
    HOLE_1:       '#0d1a14', HOLE_2: '#070d0a', HOLE_3: '#ffd700',
    VINE:         '#2e7d32', VINE_P1: '#66bb6a', VINE_P2: '#ef9a9a',
    ZOC_W:        'rgba(255,152,0,0.13)',
    ZOC_R:        'rgba(255,82,82,0.10)',
    TRAPPED:      '#ff6f00', REVIVING: '#7b1fa2',
    VINE_SLOWED:  '#66bb6a', SURROUNDED: '#ff6f00',
  },

  // ─── Vine system ─────────────────────────────────────────────────
  VINE_MAX:   3,    // max vines per player on board
  VINE_RANGE: 3,    // Engineer vine placement range

  // ─── Tire (Roller) system ─────────────────────────────────────────
  TIRE_SPEED:     3,   // hexes moved per turn
  LIGHT_COOLDOWN: 2,   // turns until light roller fires
  HEAVY_COOLDOWN: 3,   // turns until heavy roller fires

  WIN_SCORE:  5,   // 先取点数
  MAX_TURNS:  30,  // ターン上限（超過時に点数多い方の勝ち）

  // ─── Echo Points (エコーポイント) ────────────────────────────────
  ECHO_CYCLE_TURNS: 10,   // turns per cycle before forced reset
  ECHO_HOLD_TURNS:  3,    // consecutive turns holding both = 1st point
  ECHO_CONT_TURNS:  2,    // additional turns for each subsequent point
  ECHO_MAX_DIST:    5,    // max hex distance between zone centers
  ECHO_MIN_DIST:    3,    // min hex distance between zone centers
  ECHO_NEUTRAL_R:   4,    // center spawn within this row-distance of board center

  // ─── Initial piece layout for Player 1 (bottom area) ─────────────
  // Hex validity: max(|q|,|r|,|q+r|) <= 7 where q=col-7, r=row-7
  P1_LAYOUT: [
    { r:11, c:5,  type:'ROLLER'   },  // q=-2, r=4  (was ENGINEER)
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
