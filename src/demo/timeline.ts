// 把一次 layout() 的结果展开成一串动画帧。
// 播放器只管"第 i 帧画什么"，讲解顺序和节奏都在这里决定。

import type { Point, Rect } from "../core/types";
import { layout, type SeedRun } from "../core/layout";
import type { PlacementFrame } from "../core/placement";
import { TASK_QUEUE } from "./scene";

export type Phase = "structure" | "place" | "align" | "route" | "label" | "select";

export const PHASES: { key: Phase; title: string }[] = [
  { key: "structure", title: "① 结构识别：容器层级 + 簇" },
  { key: "place", title: "② 逐层放置：自底向上的网格搜索" },
  { key: "align", title: "③ 轴对齐：把相连节点拉直" },
  { key: "route", title: "④ 正交路由：可见性图 + Dijkstra" },
  { key: "label", title: "⑤ 标签放置：候选位置打分" },
  { key: "select", title: "⑥ 多 seed 竞速：按 penalty 选优" },
];

export type Frame =
  | { phase: "structure"; step: "tree" | "cluster"; note: string }
  | { phase: "place"; levelIndex: number; frame: PlacementFrame; note: string }
  | { phase: "align"; rects: Map<string, Rect>; moved?: string; note: string }
  | {
      phase: "route";
      done: Point[][];
      current?: { visited: Point[]; upto: number; points?: Point[] };
      forked: boolean;
      showOvg: boolean;
      note: string;
    }
  | { phase: "label"; upto: number; trying?: { rect: Rect; score: number }[]; note: string }
  | { phase: "select"; note: string };

export interface Timeline {
  frames: Frame[];
  runs: SeedRun[];
  best: SeedRun;
}

function sample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]);
}

const short = (id: string) => (id === "" ? "最外层" : id.split(".").pop()!);
const WAVE_STEPS = 5;

export function buildTimeline(): Timeline {
  const { runs, best } = layout(TASK_QUEUE);
  const frames: Frame[] = [];

  // ① 结构识别
  frames.push({
    phase: "structure",
    step: "tree",
    note: "D2 源码里的嵌套 = 容器树：最外层 ⊃ Application ⊃ Queue Library。放置时自底向上，最深的容器先排。",
  });
  const cl = best.tree.clusters[0];
  frames.push({
    phase: "structure",
    step: "cluster",
    note: `簇识别：${cl.members.map(short).join("、")} 的邻居完全相同（都只连 consumer），折叠成一个节点一起放，最后再竖着展开。task01..03 各连不同的 user，不成簇。`,
  });

  // ② 逐层放置：每层抽样若干帧
  best.tree.levels.forEach((lv, levelIndex) => {
    const n = lv.problem.items.length;
    const picked = sample(lv.frames, n <= 3 ? 12 : 28);
    for (const f of picked) {
      frames.push({
        phase: "place",
        levelIndex,
        frame: f,
        note: `正在排「${short(lv.level)}」这一层（${n} 个物件${lv.clusters.length ? "，簇当作 1 个" : ""}）· ${f.note}`,
      });
    }
  });

  // ③ 轴对齐：逐个回放移动
  const rects = new Map([...best.placedRects].map(([k, r]) => [k, { ...r }]));
  frames.push({ phase: "align", rects: new Map(rects), note: "网格放置完成。不同层、不同尺寸的节点中心线未必对齐，所以边还是歪的。" });
  for (const m of best.aligned) {
    rects.set(m.id, { ...m.to });
    frames.push({ phase: "align", rects: new Map(rects), moved: m.id, note: `对齐 ${m.reason}：平移 ${short(m.id)}，让这条边变成直线` });
  }

  // ④ 路由：先展示 OVG，再逐条边放出 Dijkstra 波纹
  frames.push({ phase: "route", done: [], forked: false, showOvg: true, note: `建正交可见性图：${best.routing.ovg.points.length} 个点，路线只能沿这些淡青色细线走` });
  const done: Point[][] = [];
  for (const s of best.routing.best.searches) {
    const label = `${short(s.route.from)} → ${short(s.route.to)}`;
    for (let k = 1; k <= WAVE_STEPS; k++) {
      frames.push({
        phase: "route",
        done: [...done],
        current: { visited: s.visited, upto: Math.ceil((s.visited.length * k) / WAVE_STEPS) },
        forked: false,
        showOvg: true,
        note: `Dijkstra：${label}，已探索 ${Math.ceil((s.visited.length * k) / WAVE_STEPS)} 个点`,
      });
    }
    frames.push({
      phase: "route",
      done: [...done],
      current: { visited: s.visited, upto: s.visited.length, points: s.route.points },
      forked: false,
      showOvg: true,
      note: `找到 ${label}：代价 ${s.route.cost.toFixed(0)}`,
    });
    if (s.ok) done.push(s.route.points);
  }
  frames.push({ phase: "route", done: [...done], forked: false, showOvg: false, note: `${best.routing.best.flavor} 顺序总代价最低，采用它的结果` });
  frames.push({ phase: "route", done: [], forked: true, showOvg: false, note: "簇分叉：consumer → worker01..04 改成先共用一段主干，在汇合线上分叉（TALA 的 fork 形状）" });

  // ⑤ 标签
  best.labels.forEach((l, i) => {
    const tried = best.labelTrials.get(Number(l.owner)) ?? [];
    frames.push({ phase: "label", upto: i, trying: tried, note: `「${l.text}」试了 ${tried.length} 个候选位置（红框分高、绿框分低）` });
    frames.push({ phase: "label", upto: i + 1, note: `「${l.text}」放在得分 ${l.score.toFixed(2)} 的位置` });
  });

  // ⑥ 选优
  frames.push({ phase: "select", note: "seed 1、2、3 各跑一遍完整流水线，penalty 最低的胜出" });
  return { frames, runs, best };
}
