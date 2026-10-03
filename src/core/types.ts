// mini-tala 的核心数据结构。
// 对照 TALA：d2/d2layouts/d2talalayout/internal/layoutgraph/{graph,node,edge}.go

export interface NodeSpec {
  id: string;
  label?: string;
  width?: number;
  height?: number;
}

export interface EdgeSpec {
  from: string;
  to: string;
}

export interface GraphSpec {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
}

export interface Point {
  x: number;
  y: number;
}

/** 整数网格坐标（放置阶段使用，对应 TALA 的 "sizeless" 阶段） */
export interface Cell {
  gx: number;
  gy: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "top" | "right" | "bottom" | "left";

/** 节点边上的连接点。对照 nodeshape/shape_square.go：每边 3 个，位于 25%/50%/75% */
export interface Port {
  nodeId: string;
  side: Side;
  index: 0 | 1 | 2;
  /** 端口在节点边框上的位置 */
  at: Point;
  /** 端口向外伸出一小段后的位置，路由从这里接入可见性图 */
  stub: Point;
  isCenter: boolean;
}

export interface RoutedEdge {
  edgeIndex: number;
  from: string;
  to: string;
  points: Point[];
  cost: number;
}

export interface LayoutResult {
  seed: number;
  cells: Map<string, Cell>;
  rects: Map<string, Rect>;
  routes: RoutedEdge[];
  penalty: number;
  area: number;
}
