// 可复现的伪随机数（mulberry32）。
// TALA 用 Go 的 math/rand + 固定 seed 保证同一 seed 永远得到同一张图，这里同理。

export interface Rng {
  /** [0, 1) 均匀分布 */
  next(): number;
  /** [-a, a] 均匀分布，用于放置阶段的温度抖动 */
  jitter(a: number): number;
  shuffle<T>(items: T[]): T[];
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    jitter: (a) => (next() * 2 - 1) * a,
    shuffle: (items) => {
      // Fisher–Yates，原地打乱并返回同一个数组
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    },
  };
}
