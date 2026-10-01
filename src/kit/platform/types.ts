// ゲームサイト（Poki・CrazyGames など）の広告 SDK の差し込み口。
// ゲーム本体はこの形だけを呼ぶ。どのサイト向けかはビルド時に決まる。

export interface Platform {
  readonly name: string;
  /** SDK の読み込みと初期化。ゲーム開始前に1回 */
  init(): Promise<void>;
  /** 読み込みが終わって遊べる状態になった */
  loadingFinished(): void;
  /** 操作できる状態に入った（対局開始・再開） */
  gameplayStart(): void;
  /** 操作できる状態を抜けた（決着・メニュー・一時停止） */
  gameplayStop(): void;
  /** 区切りの広告（次の対局の前など）。終わるまで待つ。広告が出なくても正常に終わる */
  commercialBreak(): Promise<void>;
  /** ごほうび付きの広告。最後まで見たら true */
  rewardedBreak(): Promise<boolean>;
}
