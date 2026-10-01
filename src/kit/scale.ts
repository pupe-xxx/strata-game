// 画面サイズの調整。
// ゲームは「論理サイズ」（例: 720×720）の座標だけで描く。
// 実際の大きさ・高精細ディスプレイへの対応はここが引き受ける。

export interface FitOptions {
  /** 論理サイズ（描画に使う座標の幅と高さ） */
  width: number;
  height: number;
  /** これ以上は拡大しない。既定は無制限 */
  maxScale?: number;
}

export interface Fit {
  /** 論理サイズに対する今の表示倍率 */
  readonly scale: number;
  /** マウス・タッチの位置（clientX/Y）を論理サイズの座標に直す */
  toLogical(clientX: number, clientY: number): { x: number; y: number };
  dispose(): void;
}

/**
 * canvas を親要素いっぱいに、縦横比を保って収める。
 * 親要素は canvas の大きさに左右されない寸法を持つこと（例: position:fixed; inset:0）。
 * 大きさが変わるたびに onResize が呼ばれるので、そこで描き直す。
 */
export function fitCanvas(canvas: HTMLCanvasElement, opts: FitOptions, onResize?: () => void): Fit {
  const parent = canvas.parentElement;
  if (!parent) throw new Error('fitCanvas: canvas に親要素が無い');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('fitCanvas: 2D コンテキストが取れない');
  let scale = 1;

  const apply = () => {
    const availW = parent.clientWidth;
    const availH = parent.clientHeight;
    if (!availW || !availH) return;
    scale = Math.min(availW / opts.width, availH / opts.height, opts.maxScale ?? Infinity);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${opts.width * scale}px`;
    canvas.style.height = `${opts.height * scale}px`;
    canvas.width = Math.round(opts.width * scale * dpr);
    canvas.height = Math.round(opts.height * scale * dpr);
    // 以後の描画は論理サイズの座標で書ける
    ctx.setTransform(canvas.width / opts.width, 0, 0, canvas.height / opts.height, 0, 0);
    onResize?.();
  };

  const observer = new ResizeObserver(apply);
  observer.observe(parent);
  window.addEventListener('resize', apply);
  apply();

  return {
    get scale() {
      return scale;
    },
    toLogical(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * opts.width,
        y: ((clientY - rect.top) / rect.height) * opts.height,
      };
    },
    dispose() {
      observer.disconnect();
      window.removeEventListener('resize', apply);
    },
  };
}
