// 今の素の JavaScript（script タグで読む4ファイル）を Node で読み込み、sim-core 用の関数一式にする
import vm from 'node:vm';
import fs from 'node:fs';

const NAMES = ['CONFIG', 'createInitialState', 'generateEchoPoints', 'resolvePreamble', 'resolvePairActions', 'resolvePostTurn', 'tickReviveTimers', 'allPieces',
  'findPieceById', 'isValidCell', 'getValidMoves', 'getValidAttacks', 'getValidReactTargets', 'getTransitDest',
  'getValidTerrainTargets', 'getValidPushTargets', 'getValidSnipeTargets', 'getValidSwapTargets', 'getValidRepairTargets',
  'getValidVineTargets', 'getValidRollerDirections', 'getValidReserveMoves', 'getValidReserveVia'];

export function loadLegacy(jsDir) {
  const math = {};
  for (const k of Object.getOwnPropertyNames(Math)) math[k] = Math[k];
  let random = Math.random;
  math.random = () => random();
  const ctx = vm.createContext({ Math: math, console });
  const src = ['config', 'state', 'logic', 'cpu'].map(f => fs.readFileSync(`${jsDir}/${f}.js`, 'utf8')).join('\n;\n');
  vm.runInContext(`${src}\n;globalThis.__api = { ${NAMES.join(', ')}, getCpuActions: s => CpuAI.getCpuActions(s) };`, ctx);
  return { ...ctx.__api, setRandom: fn => { random = fn; } };
}
