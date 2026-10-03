// mini-tala 的核心数据结构。
// 对照 TALA：d2/d2layouts/d2talalayout/internal/layoutgraph/{graph,node,edge}.go

export type Direction = "right" | "down" | "left" | "up";
export type ShapeKind = "rect" | "person" | "cylinder";

export interface NodeSpec {
  /** 全路径 id，例如 "container.queue.producer" */
  id: string;
  label?: string;
  /** 所在容器的 id；不写表示在最外层 */
  parent?: string;
  width?: number;
  height?: number;
  shape?: ShapeKind;
  /** D2 的 style.multiple：画成叠在一起的几层 */
  multiple?: boolean;
  icon?: string;
  fill?: string;
  mono?: boolean;
  /** 只对容器有意义：子节点的布局方向 */
  direction?: Direction;
}

export interface EdgeSpec {
  from: string;
  to: string;
  label?: string;
  /** D2 的 style.animated：画成流动的虚线 */
  animated?: boolean;
}

export interface GraphSpec {
  direction?: Direction;
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

export interface PlacedLabel {
  kind: "edge" | "node";
  /** 边标签：边的下标；节点标签：节点 id */
  owner: string;
  text: string;
  rect: Rect;
  score: number;
}
