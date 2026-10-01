// 音。
// ブラウザは、利用者が一度操作するまで音を鳴らせない。その解除をここが引き受ける。
// 音声ファイルが無くても tone() で仮の効果音を鳴らせるので、音は後から差し替えられる。

export interface Sound {
  /** 音声ファイルを読み込んで名前を付ける。ファイルは public/ に置く */
  load(name: string, url: string): Promise<void>;
  play(name: string, volume?: number): void;
  /** 仮の効果音（周波数 Hz・長さ ミリ秒） */
  tone(frequency: number, durationMs: number, volume?: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}

export function createSound(): Sound {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;
  const buffers = new Map<string, AudioBuffer>();

  const ensure = (): AudioContext | null => {
    if (!ctx) {
      try {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(ctx.destination);
      } catch {
        return null; // 音が使えない環境でもゲームは止めない
      }
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  };

  // 最初の操作で音を解除する
  const unlock = () => {
    ensure();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  return {
    async load(name, url) {
      const c = ensure();
      if (!c) return;
      const data = await (await fetch(url)).arrayBuffer();
      buffers.set(name, await c.decodeAudioData(data));
    },
    play(name, volume = 1) {
      const c = ensure();
      const buffer = buffers.get(name);
      if (!c || !master || !buffer) return;
      const src = c.createBufferSource();
      const gain = c.createGain();
      gain.gain.value = volume;
      src.buffer = buffer;
      src.connect(gain).connect(master);
      src.start();
    },
    tone(frequency, durationMs, volume = 0.2) {
      const c = ensure();
      if (!c || !master) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      const end = c.currentTime + durationMs / 1000;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(master);
      osc.start();
      osc.stop(end);
    },
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = value ? 0 : 1;
    },
    get muted() {
      return muted;
    },
  };
}
