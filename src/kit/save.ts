// セーブ。
// ブラウザの localStorage に JSON で保存する。
// 保存が禁止されている環境（プライベートブラウズ、ゲームサイトの埋め込み枠など）では、
// エラーにせずメモリ上だけで動く。

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Save<T> {
  load(): T;
  save(data: T): void;
  clear(): void;
}

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function browserStorage(): StorageLike {
  try {
    const s = globalThis.localStorage;
    const probe = '__probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}

/**
 * key はゲームごとに違う名前にする（例: 'strata.v1'）。
 * 保存データの形を変えた時は、既定値（defaults）に項目を足すだけなら古いデータもそのまま読める。
 * 形を作り直した時は key を変える。
 */
export function createSave<T extends object>(key: string, defaults: T, storage: StorageLike = browserStorage()): Save<T> {
  return {
    load() {
      try {
        const raw = storage.getItem(key);
        if (!raw) return { ...defaults };
        return { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
      } catch {
        return { ...defaults };
      }
    },
    save(data) {
      try {
        storage.setItem(key, JSON.stringify(data));
      } catch {
        // 容量超過など。ゲームは止めない
      }
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch {
        // 同上
      }
    },
  };
}
