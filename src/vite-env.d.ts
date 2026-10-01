/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** どのゲームサイト向けのビルドか。未指定なら広告なし */
  readonly VITE_PLATFORM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
