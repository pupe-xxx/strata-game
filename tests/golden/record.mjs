// 使い方: node record.mjs <jsフォルダ> <出力.json> [試合数]   … 正解の記録を作る
//         node record.mjs <jsフォルダ> --check <記録.json>     … 記録と照合する
import fs from 'node:fs';
import { loadLegacy } from './legacy-api.mjs';
import { runGame } from './sim-core.mjs';

const [jsDir, a2, a3] = process.argv.slice(2);
const check = a2 === '--check';
const file = check ? a3 : a2;
const api = loadLegacy(jsDir);

if (check) {
  const golden = JSON.parse(fs.readFileSync(file, 'utf8'));
  let bad = 0;
  for (const g of golden.games) {
    const r = runGame(api, g.seed);
    const at = r.turns.findIndex((h, i) => h !== g.turns[i]);
    if (at >= 0 || r.turns.length !== g.turns.length) { bad++; console.log(`seed ${g.seed}: ターン ${at} で食い違い`); }
  }
  console.log(bad ? `NG: ${bad}/${golden.games.length} 試合が食い違い` : `OK: ${golden.games.length} 試合すべて一致`);
  process.exit(bad ? 1 : 0);
}

const n = +(a3 ?? 200);
const games = [], total = {}, winners = {};
let turnSum = 0;
for (let seed = 1; seed <= n; seed++) {
  const { dumps, stats, ...g } = runGame(api, seed);
  games.push(g);
  turnSum += g.turnsPlayed;
  winners[g.winner] = (winners[g.winner] ?? 0) + 1;
  for (const [k, v] of Object.entries(stats)) total[k] = (total[k] ?? 0) + v;
}
fs.writeFileSync(file, JSON.stringify({ note: 'STRATA の JS 版（移行前）の動作記録。先手は乱数、後手は CPU', games }));
console.log(`${n} 試合 / 合計 ${turnSum} ターン / 勝者`, winners);
console.log('行動の内訳', total);
