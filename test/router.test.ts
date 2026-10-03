import { describe, expect, it } from "vitest";
import { routeAll } from "../src/core/router";
import { nodeRects, segmentHitsRect } from "../src/core/geometry";
import type { Cell, GraphSpec, Point, Rect } from "../src/core/types";

function setup(graph: GraphSpec, cells: Record<string, [number, number]>) {
  const cellMap = new Map<string, Cell>(Object.entries(cells).map(([id, [gx, gy]]) => [id, { gx, gy }]));
  const rects = nodeRects(graph, cellMap);
  const cols = Math.max(...Object.values(cells).map(([x]) => x)) + 1;
  const rows = Math.max(...Object.values(cells).map(([, y]) => y)) + 1;
  return { rects, result: routeAll(graph.edges, rects, cols, rows) };
}

const onBorder = (p: Point, r: Rect) =>
  ((p.x === r.x || p.x === r.x + r.w) && p.y >= r.y && p.y <= r.y + r.h) ||
  ((p.y === r.y || p.y === r.y + r.h) && p.x >= r.x && p.x <= r.x + r.w);

describe("routeAll", () => {
  const g: GraphSpec = {
    nodes: ["a", "b", "c", "x"].map((id) => ({ id })),
    edges: [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "a", to: "x" },
    ],
  };
  // a 和 x 在同一行，中间夹着 b：a->x 必须绕开 b
  const { rects, result } = setup(g, { a: [0, 0], b: [1, 0], x: [2, 0], c: [0, 1] });

  it("每条边都找到了路由", () => {
    expect(result.best.searches.every((s) => s.ok)).toBe(true);
  });

  it("路由是正交的（每段水平或竖直）", () => {
    for (const s of result.best.searches) {
      const pts = s.route.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        expect(pts[i].x === pts[i + 1].x || pts[i].y === pts[i + 1].y).toBe(true);
      }
    }
  });

  it("首尾落在端点节点的边框上", () => {
    for (const s of result.best.searches) {
      const pts = s.route.points;
      expect(onBorder(pts[0], rects.get(s.route.from)!)).toBe(true);
      expect(onBorder(pts[pts.length - 1], rects.get(s.route.to)!)).toBe(true);
    }
  });

  it("不穿过任何节点内部", () => {
    for (const s of result.best.searches) {
      const pts = s.route.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        for (const r of rects.values()) expect(segmentHitsRect(pts[i], pts[i + 1], r)).toBe(false);
      }
    }
  });

  it("相邻同行的 a->b 是一条直线（2 个点）", () => {
    const ab = result.best.searches.find((s) => s.route.to === "b")!;
    expect(ab.route.points.length).toBe(2);
  });

  it("尝试了 3 种边顺序，并选出代价最低的", () => {
    expect(result.attempts.map((a) => a.flavor)).toEqual(["shortest-first", "longest-first", "declared"]);
    const min = Math.min(...result.attempts.map((a) => a.totalCost));
    expect(result.best.totalCost).toBe(min);
  });
});
