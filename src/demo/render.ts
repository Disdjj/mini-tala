// SVG 渲染：形状、容器、边、标签，以及各阶段的辅助图层。
// 视觉上尽量贴近 D2 默认主题，方便和真实 TALA 的输出并排对比。

import type { NodeSpec, Point, Rect } from "../core/types";
import type { Ovg } from "../core/ovg";

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

export function defs(svg: SVGSVGElement): void {
  const d = el("defs", {}, svg);
  for (const [id, color] of [
    ["arrow", "#0D32B2"],
    ["arrow-hot", "#f5a623"],
  ]) {
    const m = el("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, d);
    el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }, m);
  }
  // 斜纹 / 横线 / 颗粒填充，对应 D2 的 fill-pattern
  const lines = el("pattern", { id: "pat-lines", width: 6, height: 6, patternUnits: "userSpaceOnUse" }, d);
  el("rect", { width: 6, height: 6, fill: "#F7F8FE" }, lines);
  el("line", { x1: 0, y1: 3, x2: 6, y2: 3, stroke: "#CFD4EE", "stroke-width": 1 }, lines);
  const grain = el("pattern", { id: "pat-grain", width: 8, height: 8, patternUnits: "userSpaceOnUse" }, d);
  el("rect", { width: 8, height: 8, fill: "#FFEFD5" }, grain);
  el("circle", { cx: 2, cy: 3, r: 0.6, fill: "#d9c3a0" }, grain);
  el("circle", { cx: 6, cy: 6, r: 0.5, fill: "#d9c3a0" }, grain);
}

const FILL: Record<string, string> = {
  honeydew: "#F0FFF0",
  PapayaWhip: "url(#pat-grain)",
};

function text(parent: Element, x: number, y: number, s: string, opts: Record<string, string | number> = {}): void {
  const lines = s.split("\n");
  const size = Number(opts["font-size"] ?? 22);
  lines.forEach((line, i) => {
    const t = el("text", { x, y: y + (i - (lines.length - 1) / 2) * size * 1.15, "text-anchor": "middle", "dominant-baseline": "central", ...opts }, parent);
    t.textContent = line;
  });
}

function personPath(r: Rect): string {
  const cx = r.x + r.w / 2;
  const headR = r.h * 0.22;
  const headCy = r.y + headR + 2;
  const bodyTop = headCy + headR * 0.9;
  return [
    `M ${cx - headR} ${headCy} a ${headR} ${headR} 0 1 0 ${2 * headR} 0 a ${headR} ${headR} 0 1 0 ${-2 * headR} 0`,
    `M ${r.x} ${r.y + r.h} C ${r.x} ${bodyTop} ${r.x + r.w} ${bodyTop} ${r.x + r.w} ${r.y + r.h} Z`,
  ].join(" ");
}

function cylinder(parent: Element, r: Rect, fill: string): void {
  const ry = 18;
  el("path", {
    d: `M ${r.x} ${r.y + ry} A ${r.w / 2} ${ry} 0 0 1 ${r.x + r.w} ${r.y + ry} L ${r.x + r.w} ${r.y + r.h - ry} A ${r.w / 2} ${ry} 0 0 1 ${r.x} ${r.y + r.h - ry} Z`,
    fill,
    stroke: "#0D32B2",
    "stroke-width": 2,
  }, parent);
  el("path", { d: `M ${r.x} ${r.y + ry} A ${r.w / 2} ${ry} 0 0 0 ${r.x + r.w} ${r.y + ry}`, fill: "none", stroke: "#0D32B2", "stroke-width": 2 }, parent);
}

/** 画一个叶子节点。multiple 会在右上方多画一层 */
export function drawNode(parent: Element, n: NodeSpec, r: Rect, opts: { focus?: boolean; ghost?: boolean } = {}): void {
  const g = el("g", { class: `node${opts.focus ? " focus" : ""}${opts.ghost ? " ghost" : ""}` }, parent);
  const stroke = opts.focus ? "#f5a623" : "#0D32B2";
  const sw = opts.focus ? 4 : 2;
  const fill = n.fill ? FILL[n.fill] ?? n.fill : n.shape === "cylinder" ? "url(#pat-lines)" : "#EDF0FD";

  if (n.shape === "person") {
    if (n.multiple) el("path", { d: personPath({ ...r, x: r.x + 10, y: r.y - 10 }), fill: "#EDF0FD", stroke, "stroke-width": sw }, g);
    el("path", { d: personPath(r), fill: "#EDF0FD", stroke, "stroke-width": sw }, g);
    text(g, r.x + r.w / 2, r.y + r.h + 20, n.label ?? n.id, { "font-size": 24, "font-weight": 700, fill: "#0A0F25" });
    return;
  }
  if (n.shape === "cylinder") {
    cylinder(g, r, fill);
  } else {
    if (n.multiple) el("rect", { x: r.x + 10, y: r.y - 10, width: r.w, height: r.h, fill: "#EDF0FD", stroke, "stroke-width": sw }, g);
    el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: n.mono ? 8 : 0, fill, stroke, "stroke-width": sw }, g);
  }
  const font: Record<string, string> = n.mono ? { "font-family": "ui-monospace, Menlo, monospace" } : {};
  if (n.icon) {
    // 有图标：图标居中，标签放在节点外侧上方（和 D2 一致）
    el("image", { href: n.icon, x: r.x + r.w / 2 - 28, y: r.y + r.h / 2 - 28, width: 56, height: 56 }, g);
    text(g, r.x + r.w / 2, r.y - 22, n.label ?? n.id, { "font-size": 26, "font-weight": 700, fill: "#0A0F25", ...font });
  } else {
    text(g, r.x + r.w / 2, r.y + r.h / 2, n.label ?? n.id, { "font-size": 26, "font-weight": 700, fill: "#0A0F25", ...font });
  }
}

export function drawContainer(parent: Element, n: NodeSpec, r: Rect, opts: { focus?: boolean } = {}): void {
  const g = el("g", { class: "container" }, parent);
  el("rect", {
    x: r.x,
    y: r.y,
    width: r.w,
    height: r.h,
    fill: n.fill ? FILL[n.fill] ?? n.fill : "#E3E9FD",
    stroke: opts.focus ? "#f5a623" : "#0D32B2",
    "stroke-width": opts.focus ? 5 : 2,
  }, g);
  text(g, r.x + r.w / 2, r.y + 24, n.label ?? n.id, { "font-size": 26, "font-weight": 700, fill: "#0A0F25" });
  if (n.icon) el("image", { href: n.icon, x: r.x + r.w / 2 - 20, y: r.y + 40, width: 40, height: 40 }, g);
}

export function drawRoute(parent: Element, points: Point[], opts: { hot?: boolean; animated?: boolean } = {}): void {
  if (points.length < 2) return;
  el("polyline", {
    points: points.map((p) => `${p.x},${p.y}`).join(" "),
    class: `edge${opts.hot ? " hot" : ""}${opts.animated ? " animated" : ""}`,
    "marker-end": opts.hot ? "url(#arrow-hot)" : "url(#arrow)",
  }, parent);
}

export function drawLabel(parent: Element, r: Rect, s: string, cls = "edge-label"): void {
  el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 4, class: `${cls}-bg` }, parent);
  text(parent, r.x + r.w / 2, r.y + r.h / 2, s, { "font-size": 20, "font-weight": 700, class: cls });
}

export function drawOvg(parent: Element, ovg: Ovg): void {
  const g = el("g", { class: "ovg" }, parent);
  ovg.adj.forEach((list, i) => {
    const a = ovg.points[i];
    for (const e of list) {
      if (e.to < i) continue;
      const b = ovg.points[e.to];
      el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, g);
    }
  });
}

export function drawWave(parent: Element, visited: Point[], upto: number): void {
  const g = el("g", { class: "wave" }, parent);
  const n = Math.min(upto, visited.length);
  for (let i = 0; i < n; i++) {
    el("circle", { cx: visited[i].x, cy: visited[i].y, r: 5, opacity: Math.max(0.2, 1 - (n - i) / 160) }, g);
  }
}

export function drawBox(parent: Element, r: Rect, cls: string): void {
  el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 6, class: cls }, parent);
}
