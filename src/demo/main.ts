import "./style.css";
import type { NodeSpec, Rect } from "../core/types";
import type { SeedRun } from "../core/layout";
import { TASK_QUEUE } from "./scene";
import { buildTimeline, PHASES, type Frame, type Timeline } from "./timeline";
import { clear, defs, drawBox, drawContainer, drawLabel, drawNode, drawOvg, drawRoute, drawWave, el } from "./render";
import { gridToLocal } from "../core/nested";
import talaSvg from "../../examples/task-queue.tala.svg?raw";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = document.getElementById("canvas") as unknown as SVGSVGElement;
const playBtn = $<HTMLButtonElement>("play");
const stepBtn = $<HTMLButtonElement>("step");
const backBtn = $<HTMLButtonElement>("back");
const resetBtn = $<HTMLButtonElement>("reset");
const speed = $<HTMLInputElement>("speed");
const scrub = $<HTMLInputElement>("scrub");
const statusEl = $<HTMLDivElement>("status");
const phasesEl = $<HTMLOListElement>("phases");
const compareEl = $<HTMLDivElement>("compare");

const nodes = new Map<string, NodeSpec>(TASK_QUEUE.nodes.map((n) => [n.id, n]));
const short = (id: string) => (id === "" ? "最外层" : id.split(".").pop()!);

let timeline!: Timeline;
let index = 0;
let timer: number | undefined;

PHASES.forEach((p) => {
  const li = document.createElement("li");
  li.dataset.phase = p.key;
  li.textContent = p.title;
  li.addEventListener("click", () => {
    stop();
    index = timeline.frames.findIndex((f) => f.phase === p.key);
    render();
  });
  phasesEl.appendChild(li);
});

function setView(run: SeedRun): void {
  svg.setAttribute("viewBox", `0 0 ${run.width} ${run.height}`);
}

/** 按容器深度从外到内画：先容器（大框在下面），再叶子 */
function drawScene(
  run: SeedRun,
  rects: Map<string, Rect>,
  opts: { only?: Set<string>; focusNode?: string; focusContainer?: string; ghost?: Set<string> } = {},
): SVGGElement {
  const h = run.tree.hierarchy;
  const layer = el("g", {}, svg);
  const depth = (id: string) => h.ancestors(id).length;
  const ids = [...nodes.keys()].filter((id) => rects.has(id) && (!opts.only || opts.only.has(id)));
  for (const id of ids.filter((x) => h.isContainer(x)).sort((a, b) => depth(a) - depth(b))) {
    drawContainer(layer, nodes.get(id)!, rects.get(id)!, { focus: id === opts.focusContainer });
  }
  for (const id of ids.filter((x) => !h.isContainer(x))) {
    drawNode(layer, nodes.get(id)!, rects.get(id)!, { focus: id === opts.focusNode, ghost: opts.ghost?.has(id) });
  }
  return layer;
}

function drawFinalEdges(run: SeedRun, parent: Element): void {
  for (const r of run.routes) drawRoute(parent, r.points, { animated: TASK_QUEUE.edges[r.edgeIndex].animated });
}

function drawFinalLabels(run: SeedRun, parent: Element, upto = Infinity): void {
  run.labels.slice(0, upto).forEach((l) => drawLabel(parent, l.rect, l.text));
}

// ---------- 各阶段 ----------

function renderStructure(f: Extract<Frame, { phase: "structure" }>, run: SeedRun): void {
  setView(run);
  const final = drawScene(run, run.rects);
  final.setAttribute("opacity", "0.35");
  const h = run.tree.hierarchy;
  if (f.step === "tree") {
    // 容器从内到外依次描边
    const order = h.bottomUp.filter((id) => id !== "");
    order.forEach((id, i) => {
      const r = run.rects.get(id)!;
      el("rect", { x: r.x - 6, y: r.y - 6, width: r.w + 12, height: r.h + 12, class: "level-ring", style: `animation-delay:${i * 0.4}s` }, svg);
      const t = el("text", { x: r.x + 12, y: r.y + r.h - 16, class: "level-tag" }, svg);
      t.textContent = `第 ${i + 1} 个排：${short(id)}`;
    });
  } else {
    for (const c of run.tree.clusters) {
      const rs = c.members.map((m) => run.rects.get(m)!);
      const x = Math.min(...rs.map((r) => r.x)) - 18;
      const y = Math.min(...rs.map((r) => r.y)) - 18;
      const w = Math.max(...rs.map((r) => r.x + r.w)) - x + 18;
      const hh = Math.max(...rs.map((r) => r.y + r.h)) - y + 18;
      el("rect", { x, y, width: w, height: hh, rx: 16, class: "cluster-ring" }, svg);
      const t = el("text", { x: x + w / 2, y: y - 14, class: "cluster-tag" }, svg);
      t.textContent = "簇 ×4";
    }
  }
}

/**
 * 放置阶段：当前层的每个物件按"这一帧的格子"换算成真实尺寸的像素位置画出来，
 * 已经排好的内层容器作为一个整体跟着移动（这正是自底向上递归的含义）。
 */
function renderPlace(f: Extract<Frame, { phase: "place" }>, run: SeedRun): void {
  const lv = run.tree.levels[f.levelIndex];
  const h = run.tree.hierarchy;
  const sizes = new Map<string, { w: number; h: number }>();
  for (const id of lv.problem.items) sizes.set(id, { w: lv.local.get(id)!.w, h: lv.local.get(id)!.h });
  const { local, contentW, contentH } = gridToLocal(f.frame.cells, sizes);

  // 这一层的内容区放在画布中央
  const W = Math.max(run.width, contentW + 200);
  const H = Math.max(run.height, contentH + 200);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const ox = (W - contentW) / 2;
  const oy = (H - contentH) / 2;

  // 格线：按这一帧每行/列的实际位置画
  const g = el("g", {}, svg);
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const r of local.values()) {
    xs.add(r.x + r.w / 2);
    ys.add(r.y + r.h / 2);
  }
  for (const x of xs) el("line", { x1: ox + x, y1: oy - 60, x2: ox + x, y2: oy + contentH + 60, class: "grid-line" }, g);
  for (const y of ys) el("line", { x1: ox - 60, y1: oy + y, x2: ox + contentW + 60, y2: oy + y, class: "grid-line" }, g);

  const abs = (id: string) => {
    const r = local.get(id)!;
    return { x: ox + r.x, y: oy + r.y, w: r.w, h: r.h };
  };
  for (const e of lv.problem.edges) {
    const a = abs(e.from);
    const b = abs(e.to);
    el("line", { x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2, class: "straight" }, g);
  }

  for (const id of lv.problem.items) {
    const r = abs(id);
    const focus = f.frame.focus?.item === id;
    const cluster = lv.clusters.find((c) => c.id === id);
    if (h.isContainer(id)) {
      // 已经排好的内层容器：整体平移它在内层的布局
      const inner = run.tree.levels.find((l) => l.level === id)!;
      const shifted = new Map<string, Rect>();
      const base = run.placedRects.get(id)!;
      const dx = r.x - base.x;
      const dy = r.y - base.y;
      const collect = (lvl: string) => {
        for (const child of h.children.get(lvl) ?? []) {
          const cr = run.placedRects.get(child)!;
          shifted.set(child, { ...cr, x: cr.x + dx, y: cr.y + dy });
          if (h.isContainer(child)) collect(child);
        }
      };
      shifted.set(id, { ...base, x: r.x, y: r.y });
      collect(id);
      drawScene(run, shifted, { only: new Set(shifted.keys()), focusContainer: focus ? id : undefined });
      void inner;
    } else if (cluster) {
      // 簇：一个合成节点，内部成员竖排
      el("rect", { x: r.x - 10, y: r.y - 10, width: r.w + 20, height: r.h + 20, rx: 14, class: focus ? "cluster-ring" : "cluster-box" }, g);
      cluster.members.forEach((m, i) => {
        const n = nodes.get(m)!;
        const mh = n.height ?? 80;
        drawNode(g, n, { x: r.x, y: r.y + i * (mh + 60), w: n.width ?? r.w, h: mh });
      });
    } else {
      drawNode(g, nodes.get(id)!, r, { focus });
    }
  }

  if (f.frame.focus) {
    // 抖动目标点：在网格坐标上插值到像素
    const t = f.frame.focus.target;
    const colXs = [...xs].sort((a, b) => a - b);
    const rowYs = [...ys].sort((a, b) => a - b);
    const lerp = (arr: number[], v: number) => {
      if (arr.length === 1) return arr[0];
      const i = Math.max(0, Math.min(arr.length - 2, Math.floor(v)));
      return arr[i] + (arr[i + 1] - arr[i]) * (v - i);
    };
    const x = ox + lerp(colXs, t.x);
    const y = oy + lerp(rowYs, t.y);
    el("circle", { cx: x, cy: y, r: 30, class: "target" }, g);
    el("line", { x1: x - 48, y1: y, x2: x + 48, y2: y, class: "target" }, g);
    el("line", { x1: x, y1: y - 48, x2: x, y2: y + 48, class: "target" }, g);
  }
  statusEl.innerHTML =
    `${f.note}<br/><span class="muted">迭代 ${f.frame.iteration}/${f.frame.totalIterations} · 温度 ${f.frame.temperature.toFixed(2)} · ` +
    `本层代价 <b>${f.frame.cost.toFixed(2)}</b></span>`;
}

function renderAlign(f: Extract<Frame, { phase: "align" }>, run: SeedRun): void {
  setView(run);
  drawScene(run, f.rects, { focusNode: f.moved });
  // 用中心连线示意每条边是否已经是直线
  for (const e of TASK_QUEUE.edges) {
    const a = f.rects.get(e.from)!;
    const b = f.rects.get(e.to)!;
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    const straight = Math.abs(ax - bx) < 1 || Math.abs(ay - by) < 1;
    el("line", { x1: ax, y1: ay, x2: bx, y2: by, class: straight ? "straight ok" : "straight bad" }, svg);
  }
  statusEl.innerHTML = f.note;
}

function renderRoute(f: Extract<Frame, { phase: "route" }>, run: SeedRun): void {
  setView(run);
  drawScene(run, run.rects);
  if (f.showOvg) drawOvg(svg, run.routing.ovg);
  const layer = el("g", {}, svg);
  if (f.forked) {
    drawFinalEdges(run, layer);
    const fk = run.forks[0];
    if (fk) el("circle", { cx: fk.junction.x, cy: fk.junction.y, r: 14, class: "junction" }, svg);
  } else {
    for (const pts of f.done) drawRoute(layer, pts);
  }
  if (f.current) {
    drawWave(svg, f.current.visited, f.current.upto);
    if (f.current.points) drawRoute(svg, f.current.points, { hot: true });
  }
  const a = run.routing.attempts.map((x) => `${x.flavor}: ${x.totalCost.toFixed(0)}`).join(" · ");
  statusEl.innerHTML = `${f.note}<br/><span class="muted">3 种边顺序的总代价：${a}</span>`;
}

function renderLabel(f: Extract<Frame, { phase: "label" }>, run: SeedRun): void {
  setView(run);
  drawScene(run, run.rects);
  const layer = el("g", {}, svg);
  drawFinalEdges(run, layer);
  drawFinalLabels(run, layer, f.upto);
  if (f.trying) {
    const max = Math.max(...f.trying.map((t) => t.score), 1);
    for (const t of f.trying) {
      drawBox(svg, t.rect, t.score === 0 ? "cand good" : t.score / max > 0.3 ? "cand bad" : "cand mid");
    }
  }
  statusEl.innerHTML = f.note;
}

function renderSelect(f: Extract<Frame, { phase: "select" }>): void {
  const runs = timeline.runs;
  const w = Math.max(...runs.map((r) => r.width));
  const h = Math.max(...runs.map((r) => r.height)) + 120;
  svg.setAttribute("viewBox", `0 0 ${w * runs.length} ${h}`);
  defs(svg);
  runs.forEach((run, i) => {
    const isBest = run.seed === timeline.best.seed;
    const g = el("g", { transform: `translate(${i * w}, 0)` }, svg);
    el("rect", { x: 20, y: 20, width: w - 40, height: h - 40, rx: 30, class: isBest ? "thumb best" : "thumb" }, g);
    const inner = el("g", {}, g);
    for (const id of run.tree.hierarchy.bottomUp.filter((x) => x !== "").reverse()) drawContainer(inner, nodes.get(id)!, run.rects.get(id)!);
    for (const n of TASK_QUEUE.nodes) if (!run.tree.hierarchy.isContainer(n.id)) drawNode(inner, n, run.rects.get(n.id)!);
    drawFinalEdges(run, inner);
    drawFinalLabels(run, inner);
    const t = el("text", { x: w / 2, y: h - 50, class: isBest ? "thumb-label best" : "thumb-label" }, g);
    t.textContent = `seed ${run.seed} · penalty ${run.penalty.toFixed(2)}${isBest ? "  ✓ 胜出" : ""}`;
  });
  statusEl.innerHTML =
    f.note +
    "<br/>" +
    runs.map((r) => `seed ${r.seed}：penalty <b>${r.penalty.toFixed(2)}</b>${r.seed === timeline.best.seed ? " ✓" : ""}`).join(" · ");
}

// ---------- 主渲染与播放控制 ----------

function render(): void {
  const f = timeline.frames[index];
  const run = timeline.best;
  clear(svg);
  if (f.phase !== "select") defs(svg);
  switch (f.phase) {
    case "structure":
      renderStructure(f, run);
      statusEl.innerHTML = f.note;
      break;
    case "place":
      renderPlace(f, run);
      break;
    case "align":
      renderAlign(f, run);
      break;
    case "route":
      renderRoute(f, run);
      break;
    case "label":
      renderLabel(f, run);
      break;
    case "select":
      renderSelect(f);
      break;
  }
  const cur = PHASES.findIndex((p) => p.key === f.phase);
  phasesEl.querySelectorAll("li").forEach((li, i) => {
    li.classList.toggle("active", i === cur);
    li.classList.toggle("done", i < cur);
  });
  scrub.value = String(index);
  compareEl.hidden = f.phase !== "select";
}

/** 速度滑块 1..5 → 每帧间隔（ms）；不同阶段节奏不同 */
function interval(f: Frame): number {
  const base = [0, 600, 380, 220, 120, 50][Number(speed.value)] ?? 220;
  if (f.phase === "place") return base * 0.6;
  if (f.phase === "route") return f.current && !f.current.points ? base * 0.5 : base * 2;
  if (f.phase === "structure" || f.phase === "select") return base * 8;
  return base * 3;
}

function stop(): void {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
  playBtn.textContent = "▶ 播放";
}

function tick(): void {
  if (index >= timeline.frames.length - 1) return stop();
  index++;
  render();
  timer = window.setTimeout(tick, interval(timeline.frames[index]));
}

function play(): void {
  if (timer !== undefined) return stop();
  if (index >= timeline.frames.length - 1) index = 0;
  playBtn.textContent = "⏸ 暂停";
  timer = window.setTimeout(tick, interval(timeline.frames[index]));
}

function go(delta: number): void {
  stop();
  index = Math.max(0, Math.min(timeline.frames.length - 1, index + delta));
  render();
}

playBtn.addEventListener("click", play);
stepBtn.addEventListener("click", () => go(1));
backBtn.addEventListener("click", () => go(-1));
resetBtn.addEventListener("click", () => {
  stop();
  index = 0;
  render();
});
scrub.addEventListener("input", () => {
  stop();
  index = Number(scrub.value);
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === " ") {
    e.preventDefault();
    play();
  } else if (e.key === "ArrowRight") go(1);
  else if (e.key === "ArrowLeft") go(-1);
});

// 真实 TALA 的渲染结果，放在选优阶段旁边对比
compareEl.innerHTML = talaSvg;

timeline = buildTimeline();
scrub.max = String(timeline.frames.length - 1);
render();
