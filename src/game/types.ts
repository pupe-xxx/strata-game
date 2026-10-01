// ===== STRATA — 型の定義 =====
import type { PieceType } from './config';

export type Owner = 'p1' | 'p2';
export type Layer = 'surface' | 'depth';
export type TerrainDir = 'up' | 'down';
export type Controller = Owner | 'contested' | null;

export const LAYERS: readonly Layer[] = ['surface', 'depth'];
export const OWNERS: readonly Owner[] = ['p1', 'p2'];

export interface Terrain {
  type: 'flat' | 'wall' | 'hole' | 'vine';
  stage: number;
  placedBy?: Owner; // 蔦を置いた側
}

export interface ReservedMove {
  toR: number; toC: number; toLayer: Layer;
  viaR: number | null; viaC: number | null; viaLayer: Layer | null;
}

export interface ChargingSkill {
  subtype: 'light' | 'heavy';
  dir: [number, number];
  turnsLeft: number;
}

export interface Piece {
  id: string;
  type: PieceType;
  owner: Owner;
  hp: number;
  maxHp: number;
  trapped: boolean;
  reviving: boolean;
  reviveTimer: number;
  justRevived: boolean;
  vineSlowed: boolean;
  surrounded: boolean;
  reservedMove: ReservedMove | null;
  chargingSkill: ChargingSkill | null;
  // 駒には設定されていない（高さは CONFIG.PIECES[type].height にある）。
  // applyLandingEffect がこれを見ているため、穴に落ちても trapped にならない。移行前からの動作
  height?: number;
}

export interface Cell {
  terrain: Terrain;
  piece: Piece | null;
}
export type Grid = Cell[][];

export interface CellRef { r: number; c: number; layer: Layer }

export interface Tire {
  id: string;
  r: number; c: number; layer: Layer;
  dr: number; dc: number;
  subtype: 'light' | 'heavy';
  owner: Owner;
}

export interface EchoPoint {
  active: boolean;
  surfaceR: number | null; surfaceC: number | null;
  depthR: number | null; depthC: number | null;
  cycleTimer: number;
  cycleExpired: boolean;
  holdTimer: number;
  holdOwner: Owner | null;
  nextScoreAt: number;
}

// ── 行動 ─────────────────────────────────────────────────────────

export type TargetActionType =
  | 'MOVE' | 'ATTACK' | 'TERRAIN' | 'TRANSIT' | 'ESCAPE' | 'REACT' | 'RESERVE_SET'
  | 'SKILL_VINE' | 'SKILL_PUSH' | 'SKILL_SNIPE' | 'SKILL_SWAP' | 'SKILL_REPAIR'
  | 'SKILL_ROLLER_LIGHT' | 'SKILL_ROLLER_HEAVY';

/** 駒が、あるマスに対して行う行動 */
export interface TargetAction {
  owner: Owner;
  type: TargetActionType;
  pieceId: string;
  fromLayer: Layer; fromR: number; fromC: number;
  toLayer: Layer; toR: number; toC: number;
  terrainDir?: TerrainDir | null;
}

/** 予約移動の実行（ターン確定時に自動で足される） */
export interface ReservedMoveAction {
  owner: Owner;
  type: 'RESERVED_MOVE';
  pieceId: string;
  fromLayer: Layer; fromR: number; fromC: number;
  toLayer: Layer; toR: number; toC: number;
  viaLayer: Layer | null; viaR: number | null; viaC: number | null;
}

export interface DeployAction {
  owner: Owner;
  type: 'DEPLOY';
  pieceId: string;
  pieceType?: PieceType;
  toLayer: Layer; toR: number; toC: number;
}

export interface PassAction {
  owner: Owner;
  type: 'PASS';
}

export type Action = TargetAction | ReservedMoveAction | DeployAction | PassAction;

/** 指定した種類の行動だけを取り出す */
export function ofType(actions: readonly Action[], ...types: TargetActionType[]): TargetAction[] {
  return actions.filter((a): a is TargetAction => (types as string[]).includes(a.type));
}

// ── ゲームの状態 ─────────────────────────────────────────────────

export interface GameState {
  surface: Grid;
  depth: Grid;

  turn: number;
  phase: 'PLAYER_INPUT' | 'RESOLVING' | 'GAME_OVER';
  viewLayer: Layer;

  p1Hand: Piece[];
  p2Hand: Piece[];

  playerActions: Action[];

  p1Vines: CellRef[]; // 古い順
  p2Vines: CellRef[];

  tires: Tire[];
  tireCount: number;

  damagedThisTurn: string[];

  occScore: Record<Owner, number>;
  echoPoint: EchoPoint;
  occMeta: { echoSurface: Controller; echoDepth: Controller };

  // 画面用の項目（移行前から状態に混ざっている）
  selected: CellRef | null;
  actionMode: string | null;
  terrainDir: TerrainDir | null;
  validCells: CellRef[];
  attackCells: CellRef[];

  winner: Owner | 'draw' | null;
  message: string;
}
