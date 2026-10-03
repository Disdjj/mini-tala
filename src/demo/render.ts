// SVG 渲染：每一帧都整体重画（图很小，简单优先）。
import type { GraphSpec, Point, Rect } from "../core/types";
import type { Ovg } from "../core/ovg";
import { CELL_H, CELL_W, MARGIN } from "../core/geometry";

const NS = "http://www.w3.org/2000/svg";

export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

export const clear = (svg: SVGSVGElement): void => svg.replaceChildren();

export function setViewBox(svg: SVGSVGElement, cols: number, rows: number): void {
  svg.setAttribute("viewBox", `0 0 ${2 * MARGIN + cols * CELL_W} ${2 * MARGIN + rows * CELL_H}`);
}

/** 虚线网格：放置阶段节点只能落在格子里 */
export function drawGrid(parent: Element, cols: number, rows: number): void {
  const g = el("g", {}, parent);
  for (let i = 0; i <= cols; i++) {
    const x = MARGIN + i * CELL_W;
    el("line", { x1: x, y1: MARGIN, x2: x, y2: MARGIN + rows * CELL_H, class: "grid-line" }, g);
  }
  for (let j = 0; j <= rows; j++) {
    const y = MARGIN + j * CELL_H;
    el("line", { x1: MARGIN, y1: y, x2: MARGIN + cols * CELL_W, y2: y, class: "grid-line" }, g);
  }
}

export function drawNodes(parent: Element, graph: GraphSpec, rects: Map<string, Rect>, focusId?: string): void {
  const g = el("g", {}, parent);
  for (const n of graph.nodes) {
    const r = rects.get(n.id);
    if (!r) continue;
    const ng = el("g", { class: n.id === focusId ? "node focus" : "node" }, g);
    el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 8 }, ng);
    const t = el("text", { x: r.x + r.w / 2, y: r.y + r.h / 2 }, ng);
    t.textContent = n.label ?? n.id;
  }
}

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** 放置阶段还没有路由，边用中心连线（虚线）示意 */
export function drawStraightEdges(parent: Element, graph: GraphSpec, rects: Map<string, Rect>): void {
  const g = el("g", {}, parent);
  for (const e of graph.edges) {
    const a = rects.get(e.from);
    const b = rects.get(e.to);
    if (!a || !b || e.from === e.to) continue;
    const p = center(a);
    const q = center(b);
    el("line", { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: "edge straight" }, g);
  }
}

export function ensureArrowMarker(svg: SVGSVGElement): void {
  const defs = el("defs", {}, svg);
  for (const [id, color] of [
    ["arrow", "var(--edge)"],
    ["arrow-hot", "var(--focus)"],
  ]) {
    const m = el(
      "marker",
      { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
      defs,
    );
    el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }, m);
  }
}

export function drawRoute(parent: Element, points: Point[], current = false): void {
  if (points.length < 2) return;
  el(
    "polyline",
    {
      points: points.map((p) => `${p.x},${p.y}`).join(" "),
      class: current ? "edge current" : "edge",
      "marker-end": current ? "url(#arrow-hot)" : "url(#arrow)",
    },
    parent,
  );
}

/** 可见性图的边（很淡），让人看到"路由只能沿这些线走" */
export function drawOvg(parent: Element, ovg: Ovg): void {
  const g = el("g", {}, parent);
  ovg.adj.forEach((list, i) => {
    const a = ovg.points[i];
    for (const e of list) {
      if (e.to < i) continue;
      const b = ovg.points[e.to];
      el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "ovg-edge" }, g);
    }
  });
}

/** Dijkstra 的探索点：越早出堆越亮，形成"扩散波纹" */
export function drawWave(parent: Element, visited: Point[], upto: number): void {
  const g = el("g", {}, parent);
  const n = Math.min(upto, visited.length);
  for (let i = 0; i < n; i++) {
    const age = n - i;
    el("circle", { cx: visited[i].x, cy: visited[i].y, r: 3.2, class: "wave", opacity: Math.max(0.15, 1 - age / 120) }, g);
  }
}

/** 抖动目标点：节点"想去"的位置 */
export function drawTarget(parent: Element, target: { x: number; y: number }): void {
  const cx = MARGIN + target.x * CELL_W + CELL_W / 2;
  const cy = MARGIN + target.y * CELL_H + CELL_H / 2;
  el("circle", { cx, cy, r: 26, class: "target" }, parent);
  el("line", { x1: cx - 40, y1: cy, x2: cx + 40, y2: cy, class: "target" }, parent);
  el("line", { x1: cx, y1: cy - 40, x2: cx, y2: cy + 40, class: "target" }, parent);
}
