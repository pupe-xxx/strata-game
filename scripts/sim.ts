// 画面なしで CPU 同士を対戦させ、勝敗の内訳を出す。
// 使い方: npm run sim -- [試合数] [最初の種]
import { playMany } from '../src/game/sim';

const games = Number(process.argv[2] ?? 100);
const firstSeed = Number(process.argv[3] ?? 1);

const started = performance.now();
const t = playMany(games, firstSeed);
const sec = ((performance.now() - started) / 1000).toFixed(1);

const pct = (n: number) => `${((n / games) * 100).toFixed(1)}%`;
console.log(`${games} 試合（種 ${firstSeed}〜${firstSeed + games - 1}）  ${sec}秒`);
console.log(`先手(p1)の勝ち ${t.p1} (${pct(t.p1)})  後手(p2)の勝ち ${t.p2} (${pct(t.p2)})  引き分け ${t.draw} (${pct(t.draw)})`);
if (t.unfinished) console.log(`決着しなかった試合 ${t.unfinished}`);
console.log(`平均ターン数 ${t.averageTurns.toFixed(1)}  平均得点 先手 ${t.averageScore.p1.toFixed(2)} / 後手 ${t.averageScore.p2.toFixed(2)}`);
