// 簇分叉：让一个源连到整个簇的多条边先共用一段主干，再在中间汇合点分叉。
// 对照 TALA：internal/routing/postprocess.go（FixClusterEdgeBranching）
//         以及 coordinator.go 里簇边共享端口的规则
//
// 例如 consumer -> worker01..04：
//   consumer 右侧中点 ──主干──▶ 汇合线 x = (queue 右边 + 簇左边) / 2 ──┬──▶ worker01
//                                                                  ├──▶ worker02
//                                                                  …
// 主干完全重合，所以不算交叉；路线穿过节点时放弃，保留 Dijkstra 的结果。

import type { Point, Rect, RoutedEdge } from "./types";
import type { Cluster } from "./clusters";
import type { Hierarchy } from "./hierarchy";
import { liftTo } from "./hierarchy";
import { segmentHitsRect } from "./geometry";

const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;

export interface ForkResult {
  cluster: Cluster;
  source: string;
  junction: Point;
  edgeIndices: number[];
}

export function forkClusterEdges(
  h: Hierarchy,
  clusters: Cluster[],
  rects: Map<string, Rect>,
  routes: RoutedEdge[],
  obstacles: Map<string, Rect>,
): ForkResult[] {
  const results: ForkResult[] = [];
  for (const cluster of clusters) {
    const members = new Set(cluster.members);
    const incoming = routes.filter((r) => members.has(r.to) || members.has(r.from));
    const sources = new Set(incoming.map((r) => (members.has(r.to) ? r.from : r.to)));
    if (sources.size !== 1 || incoming.length < 2) continue;
    const source = [...sources][0];
    const src = rects.get(source)!;
    // 源在簇所在层的"代表"（比如 consumer 在 container 层就是 queue）
    const rep = rects.get(liftTo(h, source, cluster.parent) ?? source)!;
    const memberRects = cluster.members.map((m) => rects.get(m)!);
    const left = Math.min(...memberRects.map((r) => r.x));
    const right = Math.max(...memberRects.map((r) => r.x + r.w));
    const top = Math.min(...memberRects.map((r) => r.y));
    const bottom = Math.max(...memberRects.map((r) => r.y + r.h));

    const proposals = new Map<number, Point[]>();
    let junction: Point;
    if (cluster.arrangement === "column") {
      const toRight = left >= rep.x + rep.w;
      // 汇合线放在空隙中点
      const busX = Math.round(toRight ? (rep.x + rep.w + left) / 2 : (rep.x + right) / 2);
      const sy = Math.round(cy(src));
      const sx = toRight ? src.x + src.w : src.x;
      junction = { x: busX, y: sy };
      for (const r of incoming) {
        const m = rects.get(members.has(r.to) ? r.to : r.from)!;
        const my = Math.round(cy(m));
        const mx = toRight ? m.x : m.x + m.w;
        const pts = my === sy ? [{ x: sx, y: sy }, { x: mx, y: my }] : [{ x: sx, y: sy }, { x: busX, y: sy }, { x: busX, y: my }, { x: mx, y: my }];
        proposals.set(r.edgeIndex, members.has(r.to) ? pts : [...pts].reverse());
      }
    } else {
      const below = top >= rep.y + rep.h;
      const busY = Math.round(below ? (rep.y + rep.h + top) / 2 : (rep.y + bottom) / 2);
      const sx = Math.round(cx(src));
      const sy = below ? src.y + src.h : src.y;
      junction = { x: sx, y: busY };
      for (const r of incoming) {
        const m = rects.get(members.has(r.to) ? r.to : r.from)!;
        const mx = Math.round(cx(m));
        const my = below ? m.y : m.y + m.h;
        const pts = mx === sx ? [{ x: sx, y: sy }, { x: mx, y: my }] : [{ x: sx, y: sy }, { x: sx, y: busY }, { x: mx, y: busY }, { x: mx, y: my }];
        proposals.set(r.edgeIndex, members.has(r.to) ? pts : [...pts].reverse());
      }
    }

    // 安全检查：新路线不能穿过任何无关的叶子节点
    const ok = [...proposals].every(([idx, pts]) => {
      const r = routes.find((x) => x.edgeIndex === idx)!;
      for (const [id, rect] of obstacles) {
        if (id === r.from || id === r.to) continue;
        for (let i = 0; i + 1 < pts.length; i++) if (segmentHitsRect(pts[i], pts[i + 1], rect)) return false;
      }
      return true;
    });
    if (!ok) continue;

    for (const r of routes) {
      const pts = proposals.get(r.edgeIndex);
      if (pts) r.points = pts;
    }
    results.push({ cluster, source, junction, edgeIndices: [...proposals.keys()] });
  }
  return results;
}
