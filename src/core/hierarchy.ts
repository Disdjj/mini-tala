// 容器层级。
// 对照 TALA：layoutgraph 的 Containers map + placement/node_placement.go 的 AbductEdges
//
// 关键概念 edge abduction（边上提）：放置某个容器内部时，只看得到这一层的兄弟节点。
// 一条从 user01 连到 container.task01 的边，在最外层看就是 user01 -> container；
// 在 container 这一层看，task01 有一条"来自外面"的边。

import type { EdgeSpec, GraphSpec, NodeSpec } from "./types";

/** 最外层用 ROOT 表示 */
export const ROOT = "";

export interface Hierarchy {
  nodes: Map<string, NodeSpec>;
  children: Map<string, string[]>;
  parentOf: (id: string) => string;
  isContainer: (id: string) => boolean;
  /** 自顶向下的祖先链（不含自身），例如 container.queue.producer -> ["", "container", "container.queue"] */
  ancestors: (id: string) => string[];
  /** 自底向上的容器顺序：最深的容器排最前面，最后是 ROOT */
  bottomUp: string[];
}

export function buildHierarchy(graph: GraphSpec): Hierarchy {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>([[ROOT, []]]);
  for (const n of graph.nodes) children.set(n.id, []);
  for (const n of graph.nodes) children.get(n.parent ?? ROOT)!.push(n.id);

  const parentOf = (id: string) => nodes.get(id)?.parent ?? ROOT;
  const isContainer = (id: string) => id === ROOT || (children.get(id)?.length ?? 0) > 0;
  const ancestors = (id: string): string[] => {
    const chain: string[] = [];
    let p = parentOf(id);
    for (;;) {
      chain.unshift(p);
      if (p === ROOT) break;
      p = parentOf(p);
    }
    return chain;
  };

  const depth = (id: string) => (id === ROOT ? 0 : ancestors(id).length);
  const bottomUp = [...children.keys()].filter(isContainer).sort((a, b) => depth(b) - depth(a));

  return { nodes, children, parentOf, isContainer, ancestors, bottomUp };
}

/** 把节点 id 提升到"在 level 这一层可见的那个祖先"；不在这个容器里返回 undefined */
export function liftTo(h: Hierarchy, id: string, level: string): string | undefined {
  let cur = id;
  for (;;) {
    const p = h.parentOf(cur);
    if (p === level) return cur;
    if (cur === ROOT || p === ROOT) return level === ROOT ? cur : undefined;
    cur = p;
  }
}

/** 某个容器这一层看到的边：两端都提升到这一层的直接子节点；两端相同（内部边）的丢掉 */
export function edgesAtLevel(h: Hierarchy, edges: EdgeSpec[], level: string): EdgeSpec[] {
  const out: EdgeSpec[] = [];
  for (const e of edges) {
    const a = liftTo(h, e.from, level);
    const b = liftTo(h, e.to, level);
    if (a && b && a !== b) out.push({ ...e, from: a, to: b });
  }
  return out;
}

/**
 * 在 level 这一层，子节点 child 与外部世界的连接：
 * 一端在 child 内部（含 child 本身）、另一端在 level 外面的边。
 * 放置子节点时用这些边把它往外部邻居那一侧拉（TALA 的 herd / near 简化版）。
 */
export function externalEdges(h: Hierarchy, edges: EdgeSpec[], level: string): EdgeSpec[] {
  if (level === ROOT) return [];
  const inside = (id: string) => id === level || h.ancestors(id).includes(level);
  return edges.filter((e) => inside(e.from) !== inside(e.to));
}
