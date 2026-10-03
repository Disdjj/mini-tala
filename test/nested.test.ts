import { describe, expect, it } from "vitest";
import { layoutTree } from "../src/core/nested";
import { createRng } from "../src/core/random";
import { TASK_QUEUE } from "../src/demo/scene";
import type { Rect } from "../src/core/types";

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;

describe("layoutTree（任务队列场景）", () => {
  const tree = layoutTree(TASK_QUEUE, createRng(1));
  const r = (id: string) => tree.rects.get(id)!;

  it("自底向上：queue 先于 container，container 先于最外层", () => {
    expect(tree.levels.map((l) => l.level)).toEqual(["container.queue", "container", ""]);
  });

  it("识别出 worker01..04 这一个簇，task01..03 不成簇", () => {
    expect(tree.clusters).toHaveLength(1);
    expect(tree.clusters[0].members).toEqual([
      "container.worker01",
      "container.worker02",
      "container.worker03",
      "container.worker04",
    ]);
  });

  it("每个节点都在自己的容器里", () => {
    for (const n of TASK_QUEUE.nodes) {
      if (n.parent) expect(contains(r(n.parent), r(n.id)), n.id).toBe(true);
    }
  });

  it("兄弟节点互不重叠", () => {
    const ids = TASK_QUEUE.nodes.map((n) => n.id);
    for (const a of ids) {
      for (const b of ids) {
        const na = TASK_QUEUE.nodes.find((n) => n.id === a)!;
        const nb = TASK_QUEUE.nodes.find((n) => n.id === b)!;
        if (a < b && (na.parent ?? "") === (nb.parent ?? "")) expect(overlap(r(a), r(b)), `${a} / ${b}`).toBe(false);
      }
    }
  });

  it("queue 内部按 direction: right 排成 producer → database → consumer", () => {
    expect(cx(r("container.queue.producer"))).toBeLessThan(cx(r("container.queue.database")));
    expect(cx(r("container.queue.database"))).toBeLessThan(cx(r("container.queue.consumer")));
    expect(cy(r("container.queue.producer"))).toBeCloseTo(cy(r("container.queue.consumer")), 0);
  });

  it("worker 簇竖排在 queue 右侧", () => {
    const q = r("container.queue");
    for (let i = 1; i <= 4; i++) expect(r(`container.worker0${i}`).x).toBeGreaterThan(q.x + q.w);
    const xs = [1, 2, 3, 4].map((i) => r(`container.worker0${i}`).x);
    expect(new Set(xs).size).toBe(1);
  });

  it("task 都在 queue 左侧或正上/正下方，不在右边", () => {
    const q = r("container.queue");
    for (let i = 1; i <= 3; i++) expect(cx(r(`container.task0${i}`))).toBeLessThan(q.x + q.w);
  });
});
