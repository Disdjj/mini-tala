import { describe, expect, it } from "vitest";
import { countCrossings, layout, penalty } from "../src/core/layout";
import type { GraphSpec, RoutedEdge } from "../src/core/types";

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

  it("一横一竖的十字交叉记 1 次", () => {
    const h = route([[0, 5], [10, 5]]);
    const v = route([[5, 0], [5, 10]]);
    expect(countCrossings([h, v])).toBe(1);
    expect(penalty([h, v])).toBe(1);
  });

  it("端点相接或共线不算交叉", () => {
    expect(countCrossings([route([[0, 0], [10, 0]]), route([[10, 0], [10, 10]])])).toBe(0);
    expect(countCrossings([route([[0, 0], [10, 0]]), route([[5, 0], [15, 0]])])).toBe(0);
  });
});

describe("layout", () => {
  const g: GraphSpec = {
    nodes: ["web", "api", "auth", "db", "cache", "queue"].map((id) => ({ id })),
    edges: [
      { from: "web", to: "api" },
      { from: "api", to: "auth" },
      { from: "api", to: "db" },
      { from: "api", to: "cache" },
      { from: "api", to: "queue" },
      { from: "auth", to: "db" },
    ],
  };

  it("默认跑 seed 1,2,3，并选出 penalty 最低的", () => {
    const { runs, best } = layout(g);
    expect(runs.map((r) => r.result.seed)).toEqual([1, 2, 3]);
    const min = Math.min(...runs.map((r) => r.result.penalty));
    expect(best.result.penalty).toBe(min);
  });

  it("所有边都被路由", () => {
    const { best } = layout(g);
    expect(best.result.routes.length).toBe(g.edges.length);
  });

  it("完全确定：同样输入两次结果一致", () => {
    const a = layout(g).best.result;
    const b = layout(g).best.result;
    expect(a.seed).toBe(b.seed);
    expect(a.routes.map((r) => r.points)).toEqual(b.routes.map((r) => r.points));
  });
});
