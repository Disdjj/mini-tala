// 簇识别与折叠。
// 对照 TALA：internal/grouping/clusters.go（AddClusters）、layoutgraph/cluster.go
//
// 判定：同一容器内、形状相同、尺寸接近、邻居集合完全相同、边方向一致的兄弟节点 (≥2 个)
// 处理：用一个合成的 vessel 节点替换它们，按行或列排列；外部边改挂到 vessel 上。
// 放置阶段把整个簇当成一个节点，结束后再展开。
// 本例里 worker01..04（都只连 consumer）会被识别为一个簇，
// 而 task01..03 的邻居各不相同（各连一个 user），不构成簇——和真实 TALA 一致。

import type { EdgeSpec, NodeSpec } from "./types";
import type { Hierarchy } from "./hierarchy";

/** TALA：maxSizeDiff = 4.0 */
const MAX_SIZE_DIFF = 4;
/** 簇成员之间的间距。TALA：max(NodeGap=20, 平均尺寸的 10%) */
export const CLUSTER_GAP = 60;

export interface Cluster {
  id: string;
  parent: string;
  members: string[];
  /** 外部边都是左右方向时成员竖排（column），上下方向时横排（row） */
  arrangement: "column" | "row";
  width: number;
  height: number;
}

function signature(id: string, edges: EdgeSpec[]): string | undefined {
  const outs = edges.filter((e) => e.from === id).map((e) => `>${e.to}`);
  const ins = edges.filter((e) => e.to === id).map((e) => `<${e.from}`);
  const all = [...outs, ...ins].sort();
  return all.length ? all.join("|") : undefined;
}

/** 在某个容器的直接子节点中找簇。edges 是全图原始边 */
export function findClusters(
  h: Hierarchy,
  level: string,
  edges: EdgeSpec[],
  horizontal: boolean,
): Cluster[] {
  const candidates = (h.children.get(level) ?? []).filter((id) => !h.isContainer(id));
  const groups = new Map<string, NodeSpec[]>();
  for (const id of candidates) {
    const n = h.nodes.get(id)!;
    const sig = signature(id, edges);
    if (!sig) continue;
    const key = `${n.shape ?? "rect"}#${sig}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }

  const clusters: Cluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const w = Math.max(...members.map((m) => m.width ?? 0));
    const hgt = Math.max(...members.map((m) => m.height ?? 0));
    const similar = members.every(
      (m) => Math.abs((m.width ?? 0) - w) <= MAX_SIZE_DIFF * 30 && Math.abs((m.height ?? 0) - hgt) <= MAX_SIZE_DIFF * 30,
    );
    if (!similar) continue;
    const n = members.length;
    const arrangement = horizontal ? "column" : "row";
    clusters.push({
      id: `${level}::cluster(${members.map((m) => m.id.split(".").pop()).join(",")})`,
      parent: level,
      members: members.map((m) => m.id),
      arrangement,
      width: arrangement === "column" ? w : n * w + (n - 1) * CLUSTER_GAP,
      height: arrangement === "column" ? n * hgt + (n - 1) * CLUSTER_GAP : hgt,
    });
  }
  return clusters;
}
