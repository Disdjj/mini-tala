import { describe, expect, it } from "vitest";
import { place } from "../src/core/placement";
import { totalCost } from "../src/core/cost";
import type { GraphSpec } from "../src/core/types";

const chain: GraphSpec = {
  nodes: ["a", "b", "c", "d"].map((id) => ({ id })),
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
  ],
};

const star: GraphSpec = {
  nodes: ["hub", "s1", "s2", "s3", "s4"].map((id) => ({ id })),
  edges: ["s1", "s2", "s3", "s4"].map((s) => ({ from: "hub", to: s })),
};

describe("place", () => {
  it("每个节点都有格子，且格子互不重叠", () => {
    for (const g of [chain, star]) {
      const { cells } = place(g, 1);
      expect(cells.size).toBe(g.nodes.length);
      const keys = new Set([...cells.values()].map((c) => `${c.gx},${c.gy}`));
      expect(keys.size).toBe(g.nodes.length);
    }
  });

  it("同一个 seed 结果完全相同（确定性）", () => {
    const a = place(star, 7).cells;
    const b = place(star, 7).cells;
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("链状图收敛为一条直线：代价等于边数（每条边长度 1，无拐弯无逆向）", () => {
    const { cells } = place(chain, 1);
    expect(totalCost(cells, chain.edges)).toBeCloseTo(chain.edges.length, 5);
  });

  it("星形图：4 个叶子都紧贴 hub", () => {
    const { cells } = place(star, 3);
    const hub = cells.get("hub")!;
    for (const s of ["s1", "s2", "s3", "s4"]) {
      const c = cells.get(s)!;
      expect(Math.abs(c.gx - hub.gx) + Math.abs(c.gy - hub.gy)).toBe(1);
    }
  });

  it("产出动画帧，第一帧是初始化", () => {
    const { frames } = place(chain, 1);
    expect(frames.length).toBeGreaterThan(2);
    expect(frames[0].note).toContain("初始化");
  });
});
