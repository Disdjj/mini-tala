// 把一次 layout() 的结果展开成一串动画帧。
// 播放器只管"第 i 帧画什么"，所有算法细节都在这里决定讲解顺序。

import type { GraphSpec, Point } from "../core/types";
import { layout, type SeedRun } from "../core/layout";
import type { PlacementFrame } from "../core/placement";

export type Phase = "place" | "route" | "select";

export type Frame =
  | { kind: "place"; seed: number; frame: PlacementFrame; total: number }
  | {
      kind: "route";
      seed: number;
      /** 已完成的路由 */
      done: Point[][];
      /** 当前正在搜索的边 */
      current?: { visited: Point[]; upto: number; points?: Point[]; label: string };
    }
  | { kind: "select"; runs: SeedRun[]; bestSeed: number };

export interface Timeline {
  frames: Frame[];
  runs: SeedRun[];
  best: SeedRun;
}

/** 放置阶段的帧太多（几百轮），抽样到大约 maxFrames 帧，但保留首尾 */
function samplePlacement(frames: PlacementFrame[], maxFrames: number): PlacementFrame[] {
  if (frames.length <= maxFrames) return frames;
  const out: PlacementFrame[] = [];
  const step = (frames.length - 1) / (maxFrames - 1);
  for (let i = 0; i < maxFrames; i++) out.push(frames[Math.round(i * step)]);
  return out;
}

const WAVE_STEPS = 6;

export function buildTimeline(graph: GraphSpec): Timeline {
  const { runs, best } = layout(graph);
  const frames: Frame[] = [];

  // ① 只详细演示胜出 seed 的放置过程（另外两个 seed 在第 ③ 步对比）
  const placeFrames = samplePlacement(best.frames, 70);
  for (const f of placeFrames) {
    frames.push({ kind: "place", seed: best.result.seed, frame: f, total: best.frames.length });
  }

  // ② 胜出方案里的边逐条路由：先放出搜索波纹，再画出最终路线
  const searches = best.routing.best.searches;
  const done: Point[][] = [];
  searches.forEach((s, idx) => {
    const label = `第 ${idx + 1}/${searches.length} 条边：${s.route.from} → ${s.route.to}`;
    for (let k = 1; k <= WAVE_STEPS; k++) {
      const upto = Math.ceil((s.visited.length * k) / WAVE_STEPS);
      frames.push({
        kind: "route",
        seed: best.result.seed,
        done: [...done],
        current: { visited: s.visited, upto, label },
      });
    }
    frames.push({
      kind: "route",
      seed: best.result.seed,
      done: [...done],
      current: { visited: s.visited, upto: s.visited.length, points: s.route.points, label },
    });
    if (s.ok) done.push(s.route.points);
  });
  frames.push({ kind: "route", seed: best.result.seed, done: [...done] });

  // ③ 三个 seed 并排比较
  frames.push({ kind: "select", runs, bestSeed: best.result.seed });

  return { frames, runs, best };
}
