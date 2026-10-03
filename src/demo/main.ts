import "./style.css";
import type { GraphSpec } from "../core/types";
import { nodeRects, CELL_W, CELL_H, MARGIN } from "../core/geometry";
import { EXAMPLES } from "./examples";
import { buildTimeline, type Frame, type Timeline } from "./timeline";
import {
  clear,
  drawGrid,
  drawNodes,
  drawOvg,
  drawRoute,
  drawStraightEdges,
  drawTarget,
  drawWave,
  el,
  ensureArrowMarker,
  setViewBox,
} from "./render";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = document.getElementById("canvas") as unknown as SVGSVGElement;
const exampleSel = $<HTMLSelectElement>("example");
const playBtn = $<HTMLButtonElement>("play");
const stepBtn = $<HTMLButtonElement>("step");
const resetBtn = $<HTMLButtonElement>("reset");
const speed = $<HTMLInputElement>("speed");
const statusEl = $<HTMLDivElement>("status");
const explainEl = $<HTMLDivElement>("explain");
const chart = $<HTMLCanvasElement>("chart");

const EXPLAIN: Record<Frame["kind"], string> = {
  place: `每一轮把节点<b>随机打乱</b>后逐个移动：目标点 = 邻居坐标<b>中位数</b> + <b>温度抖动</b>（虚线十字），
    再在目标点附近找代价最低的空格。温度从 <code>2√N</code> 几何衰减到 0.2，最后做几轮纯贪心收尾。
    代价 = 距离 + 对角拐弯罚 + 遮挡罚 + 逆向（向上/向左）罚。<br/>对照 <code>placement/node_placement.go</code>`,
  route: `先在节点之间建<b>正交可见性图</b>（淡青色细线）：端口坐标和格线做笛卡尔积，只连同一行/列的相邻点。
    每条边在这张图上跑 <b>Dijkstra</b>（青色波纹是探索顺序），拐弯、交叉、和已有线重叠都要付代价。
    边按 3 种顺序各路由一遍，取总代价最低的。<br/>对照 <code>routing/ovg.go</code>、<code>ovg_edge_router.go</code>`,
  select: `同一张图用 seed <b>1、2、3</b> 各跑一遍完整流水线，按
    <code>penalty = 0.5×拐点 + 3×斜线 + 交叉数</code> 打分，<b>越低越好</b>；平局再比面积。
    这就是 TALA 的"多 seed 竞速"。<br/>对照 <code>quality/scoring.go</code>、<code>layout.go</code>`,
};

let timeline!: Timeline;
let graph!: GraphSpec;
let index = 0;
let timer: number | undefined;

function gridSize(cells: Iterable<{ gx: number; gy: number }>): { cols: number; rows: number } {
  let cols = 1;
  let rows = 1;
  for (const c of cells) {
    cols = Math.max(cols, c.gx + 1);
    rows = Math.max(rows, c.gy + 1);
  }
  return { cols, rows };
}

function renderPlace(f: Extract<Frame, { kind: "place" }>): void {
  const { cols, rows } = gridSize(f.frame.cells.values());
  // 抖动目标点可能落在当前网格外，视野要把它也包进来
  const t = f.frame.focus?.target;
  const viewCols = Math.max(cols, 3, t ? Math.ceil(t.x + 1) : 0);
  const viewRows = Math.max(rows, 3, t ? Math.ceil(t.y + 1) : 0);
  setViewBox(svg, viewCols, viewRows);
  drawGrid(svg, viewCols, viewRows);
  const rects = nodeRects(graph, f.frame.cells);
  drawStraightEdges(svg, graph, rects);
  drawNodes(svg, graph, rects, f.frame.focus?.nodeId);
  if (t && t.x >= -0.5 && t.y >= -0.5) drawTarget(svg, t);
  statusEl.innerHTML =
    `seed <b>${f.seed}</b> · 迭代 ${f.frame.iteration}/${f.total - 1}<br/>` +
    `温度 ${f.frame.temperature.toFixed(2)} · 放置代价 <b>${f.frame.cost.toFixed(2)}</b><br/>` +
    `<span style="color:var(--muted)">${f.frame.note}</span>`;
}

function renderRoute(f: Extract<Frame, { kind: "route" }>): void {
  const best = timeline.best;
  const { cols, rows } = gridSize(best.result.cells.values());
  setViewBox(svg, cols, rows);
  ensureArrowMarker(svg);
  drawOvg(svg, best.routing.ovg);
  const layer = el("g", {}, svg);
  for (const pts of f.done) drawRoute(layer, pts);
  if (f.current) {
    drawWave(svg, f.current.visited, f.current.upto);
    if (f.current.points) drawRoute(svg, f.current.points, true);
  }
  drawNodes(svg, graph, best.result.rects);
  const r = best.routing;
  statusEl.innerHTML =
    `seed <b>${f.seed}</b> · 顺序 <b>${r.best.flavor}</b> 胜出<br/>` +
    (f.current
      ? `${f.current.label} · 已探索 ${f.current.upto} 个点`
      : `全部 ${f.done.length} 条边路由完成`) +
    `<br/><span style="color:var(--muted)">${r.attempts
      .map((a) => `${a.flavor}: ${a.totalCost.toFixed(0)}`)
      .join(" · ")}</span>`;
}

function renderSelect(f: Extract<Frame, { kind: "select" }>): void {
  // 三个 seed 的最终结果并排画在一张大画布上
  const sizes = f.runs.map((r) => gridSize(r.result.cells.values()));
  const panelW = Math.max(...sizes.map((s) => 2 * MARGIN + s.cols * CELL_W));
  const panelH = Math.max(...sizes.map((s) => 2 * MARGIN + s.rows * CELL_H)) + 60;
  svg.setAttribute("viewBox", `0 0 ${panelW * f.runs.length} ${panelH}`);
  ensureArrowMarker(svg);
  f.runs.forEach((run, i) => {
    const isBest = run.result.seed === f.bestSeed;
    const g = el("g", { transform: `translate(${i * panelW}, 0)` }, svg);
    el("rect", { x: 8, y: 8, width: panelW - 16, height: panelH - 16, rx: 14, class: isBest ? "thumb-frame best" : "thumb-frame" }, g);
    for (const route of run.result.routes) drawRoute(g, route.points);
    drawNodes(g, graph, run.result.rects);
    const t = el("text", { x: panelW / 2, y: panelH - 22, class: isBest ? "thumb-label best" : "thumb-label" }, g);
    t.textContent = `seed ${run.result.seed} · penalty ${run.result.penalty.toFixed(1)}${isBest ? " ✓ 胜出" : ""}`;
  });
  statusEl.innerHTML = f.runs
    .map((r) => {
      const mark = r.result.seed === f.bestSeed ? " ✓" : "";
      return `seed ${r.result.seed}：penalty <b>${r.result.penalty.toFixed(1)}</b>，面积 ${(r.result.area / 1000).toFixed(0)}k${mark}`;
    })
    .join("<br/>");
}

function updatePhases(kind: Frame["kind"]): void {
  const order: Frame["kind"][] = ["place", "route", "select"];
  const cur = order.indexOf(kind);
  document.querySelectorAll<HTMLLIElement>("#phases li").forEach((li) => {
    const i = order.indexOf(li.dataset.phase as Frame["kind"]);
    li.classList.toggle("active", i === cur);
    li.classList.toggle("done", i < cur);
  });
  explainEl.innerHTML = EXPLAIN[kind];
}

/** 代价曲线：放置阶段每轮的总代价，当前帧位置用竖线标出 */
function drawChart(): void {
  const ctx = chart.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = chart.clientWidth || 320;
  const h = 110;
  chart.width = w * dpr;
  chart.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const costs = timeline.best.frames.map((f) => f.cost);
  const max = Math.max(...costs);
  const min = Math.min(...costs);
  const pad = 10;
  const x = (i: number) => pad + ((w - 2 * pad) * i) / Math.max(1, costs.length - 1);
  const y = (c: number) => h - pad - ((h - 2 * pad) * (c - min)) / Math.max(1e-9, max - min);

  ctx.strokeStyle = "#5b8def";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  costs.forEach((c, i) => (i ? ctx.lineTo(x(i), y(c)) : ctx.moveTo(x(i), y(c))));
  ctx.stroke();

  ctx.fillStyle = "#8a93a6";
  ctx.font = "11px sans-serif";
  ctx.fillText(`放置代价 ${max.toFixed(1)} → ${costs[costs.length - 1].toFixed(1)}`, w - pad - 140, 14);

  const f = timeline.frames[index];
  if (f?.kind === "place") {
    const i = timeline.best.frames.indexOf(f.frame);
    ctx.strokeStyle = "#f5b942";
    ctx.beginPath();
    ctx.moveTo(x(i), pad);
    ctx.lineTo(x(i), h - pad);
    ctx.stroke();
  }
}

function render(): void {
  const f = timeline.frames[index];
  clear(svg);
  if (f.kind === "place") renderPlace(f);
  else if (f.kind === "route") renderRoute(f);
  else renderSelect(f);
  updatePhases(f.kind);
  drawChart();
}

// ---------- 播放控制 ----------

/** 速度滑块 1..5 → 每帧间隔（ms）。放置阶段帧多，播放得快一些 */
function interval(kind: Frame["kind"]): number {
  const base = [0, 420, 260, 150, 80, 35][Number(speed.value)] ?? 150;
  if (kind === "place") return base;
  if (kind === "route") return base * 1.4;
  return base * 4;
}

function stop(): void {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
  playBtn.textContent = "▶ 播放";
}

function tick(): void {
  if (index >= timeline.frames.length - 1) {
    stop();
    return;
  }
  index++;
  render();
  timer = window.setTimeout(tick, interval(timeline.frames[index].kind));
}

function play(): void {
  if (timer !== undefined) {
    stop();
    return;
  }
  if (index >= timeline.frames.length - 1) index = 0;
  playBtn.textContent = "⏸ 暂停";
  timer = window.setTimeout(tick, interval(timeline.frames[index].kind));
}

function load(i: number): void {
  stop();
  graph = EXAMPLES[i].graph;
  timeline = buildTimeline(graph);
  index = 0;
  render();
}

EXAMPLES.forEach((ex, i) => {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = ex.name;
  exampleSel.appendChild(opt);
});

exampleSel.addEventListener("change", () => load(Number(exampleSel.value)));
playBtn.addEventListener("click", play);
stepBtn.addEventListener("click", () => {
  stop();
  if (index < timeline.frames.length - 1) {
    index++;
    render();
  }
});
resetBtn.addEventListener("click", () => {
  stop();
  index = 0;
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
  if (e.key === " ") {
    e.preventDefault();
    play();
  } else if (e.key === "ArrowRight") {
    stepBtn.click();
  }
});

load(0);
