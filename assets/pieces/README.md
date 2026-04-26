# 駒画像フォルダ

このフォルダに各駒の画像を置くと、ゲーム内でチェス駒のようにマス上に立ち姿で表示されます。

## ファイル名ルール

| 駒名 | ファイル名 | 形式 |
|------|-----------|------|
| ウォーデン | warden.jpg | JPG/PNG |
| スカルプター | sculptor.jpg | JPG/PNG |
| ストライカー | striker.jpg | JPG/PNG |
| レンジャー | ranger.jpg | JPG/PNG |
| ファントム | phantom.jpg | JPG/PNG |
| エンジニア | engineer.jpg | JPG/PNG |

## 推奨画像仕様

- **向き**: 縦長（ポートレート）。縦:横 = 4:3 〜 3:2 が理想
- **背景**: 黒または透過PNG推奨（透過PNGの場合は `.png` 拡張子に変更し renderer.js の PIECE_SPRITE も更新）
- **解像度**: 200×300px 以上あれば十分

## renderer.js の設定場所

```javascript
const PIECE_SPRITE = {
  WARDEN: 'assets/pieces/warden.jpg',
  // 他の駒はコメントを外すと有効になります
  // SCULPTOR: 'assets/pieces/sculptor.jpg',
  // STRIKER:  'assets/pieces/striker.jpg',
  // RANGER:   'assets/pieces/ranger.jpg',
  // PHANTOM:  'assets/pieces/phantom.jpg',
  // ENGINEER: 'assets/pieces/engineer.jpg',
};
```

## PNG透過対応

背景透過のPNGを使いたい場合:
1. ファイルを `warden.png` として保存
2. `renderer.js` の `PIECE_SPRITE.WARDEN` を `'assets/pieces/warden.png'` に変更
3. 背景の円形クリップなしで、そのままシルエットが表示されます
