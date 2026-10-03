import { describe, expect, it } from "vitest";
import { countCrossings, layout, penalty, runSeed } from "../src/core/layout";
import { segmentHitsRect } from "../src/core/geometry";
import { TASK_QUEUE } from "../src/demo/scene";
import type { RoutedEdge } from "../src/core/types";

const route = (points: [number, number][]): RoutedEdge => ({
  edgeIndex: 0,
  from: "a",
  to: "b",
  cost: 0,
  points: points.map(([x, y]) => ({ x, y })),
});

describe("penalty", () => {
  it("直线 0 分，每个拐点 0.5 分", () => {
    expect(penalty([route([[0, 0], [10, 0]])])).toBe(0);
    expect(penalty([route([[0, 0], [10, 0], [10, 10]])])).toBe(0.5);
  });
  it("十字交叉记 1 次；端点相接、共线不算", () => {
    expect(countCrossings([route([[0, 5], [10, 5]]), route([[5, 0], [5, 10]])])).toBe(1);
    expect(countCrossings([route([[0, 0], [10, 0]]), route([[10, 0], [10, 10]])])).toBe(0);
    expect(countCrossings([route([[0, 0], [10, 0]]), route([[5, 0], [15, 0]])])).toBe(0);
  });
});

describe("完整流水线（任务队列场景）", () => {
  const run = runSeed(TASK_QUEUE, 1);
  const leaves = TASK_QUEUE.nodes.filter((n) => !run.tree.hierarchy.isContainer(n.id));

  it("12 条边全部路由成功", () => {
    expect(run.routes).toHaveLength(TASK_QUEUE.edges.length);
  });

  it("路由正交，且不穿过无关的叶子节点", () => {
    for (const r of run.routes) {
      for (let i = 0; i + 1 < r.points.length; i++) {
        const a = r.points[i];
        const b = r.points[i + 1];
        expect(a.x === b.x || a.y === b.y).toBe(true);
        for (const n of leaves) {
          if (n.id === r.from || n.id === r.to) continue;
          expect(segmentHitsRect(a, b, run.rects.get(n.id)!), `${r.from}->${r.to} 穿过 ${n.id}`).toBe(false);
        }
      }
    }
  });

  it("没有交叉", () => {
    expect(countCrossings(run.routes)).toBe(0);
  });

  it("consumer -> worker01..04 共用主干并分叉", () => {
    expect(run.forks).toHaveLength(1);
    expect(run.forks[0].edgeIndices).toHaveLength(4);
    const firsts = run.forks[0].edgeIndices.map((i) => run.routes.find((r) => r.edgeIndex === i)!.points.slice(0, 2));
    for (const f of firsts) expect(f).toEqual(firsts[0]);
  });

  it("轴对齐后 producer→database→consumer 是直线", () => {
    for (const r of run.routes.filter((x) => x.from.includes("queue.") && x.to.includes("queue."))) {
      expect(r.points).toHaveLength(2);
    }
  });

  it("所有 10 个边标签都放置了，且两两不重叠", () => {
    expect(run.labels).toHaveLength(10);
    for (let i = 0; i < run.labels.length; i++) {
      for (let j = i + 1; j < run.labels.length; j++) {
        const a = run.labels[i].rect;
        const b = run.labels[j].rect;
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(hit, `${run.labels[i].text} / ${run.labels[j].text}`).toBe(false);
      }
    }
  });
});

describe("多 seed 竞速", () => {
  it("默认跑 seed 1,2,3，选出 penalty 最低的；结果确定", () => {
    const { runs, best } = layout(TASK_QUEUE);
    expect(runs.map((r) => r.seed)).toEqual([1, 2, 3]);
    expect(best.penalty).toBe(Math.min(...runs.map((r) => r.penalty)));
    expect(layout(TASK_QUEUE).best.seed).toBe(best.seed);
  });
});
