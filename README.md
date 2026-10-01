# STRATA

表層と深層の二層の盤で、地形を変えながら戦う頭脳戦ゲーム（ブラウザ）。
TypeScript + Vite + Canvas。型は [web-game-template](https://github.com/pupe-xxx/web-game-template) から。

公開ページ: https://pupe-xxx.github.io/strata-game/

## コマンド

| コマンド | すること |
|---|---|
| `npm install` | 最初に1回 |
| `npm run dev` | 手元で動かす |
| `npm test` | 自動テスト（約40秒。移行前の記録 200 試合との照合を含む） |
| `npm run sim -- 200` | 画面なしで CPU 同士を 200 試合対戦させ、勝敗の内訳を出す |
| `npm run typecheck` | 型の検査 |
| `npm run build` | 検査してから `dist/` に公開用のファイルを作る |

`main` に push すると、テスト → ビルド → GitHub Pages への公開まで自動で進む。テストかビルドが失敗したら公開されない。

## フォルダ

```
src/
  game/      ルール。画面の処理に触れない
    config.ts   定数
    types.ts    型
    state.ts    状態の作成と基本操作
    logic.ts    ルール本体（移動・攻撃・地形・蔦・タイヤ・エコーポイント）
    turn.ts     1ターンの進め方（画面と、画面なしの対戦の両方が使う）
    cpu.ts      CPU の思考（先手でも後手でも指せる）
    sim.ts      画面なしの CPU 同士の対戦
    random.ts   乱数の差し替え口
  ui/        描画（renderer.ts）と操作（main.ts）
  kit/       どのゲームでも使う共通部分（型からのコピー）
tests/
  golden/    移行前（素の JavaScript 版）の動作記録と、それを進める仕組み
scripts/     npm run sim の入口
```

## ルールを変える時

`npm test` は、乱数を固定した 200 試合の毎ターンの盤面を、記録（`tests/golden/golden.json`）と比べる。
ルールや CPU を意図して変えると、この照合は失敗する。変わってよい理由を確かめた上で、記録を取り直す。
`tests/golden/` の `legacy-api.mjs` と `record.mjs` は、移行前の JavaScript 版から記録を取った時の道具で、今は動かない（経緯の記録として残してある）。
