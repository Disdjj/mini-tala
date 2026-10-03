import type { GraphSpec } from "../core/types";

export interface Example {
  name: string;
  graph: GraphSpec;
}

const nodes = (...ids: string[]) => ids.map((id) => ({ id }));
const edges = (...pairs: string[]) =>
  pairs.map((p) => {
    const [from, to] = p.split("->").map((s) => s.trim());
    return { from, to };
  });

export const EXAMPLES: Example[] = [
  {
    name: "微服务架构",
    graph: {
      nodes: nodes("client", "gateway", "auth", "orders", "users", "payments", "db", "cache", "queue"),
      edges: edges(
        "client -> gateway",
        "gateway -> auth",
        "gateway -> orders",
        "gateway -> users",
        "orders -> payments",
        "orders -> db",
        "users -> db",
        "users -> cache",
        "payments -> queue",
        "auth -> cache",
      ),
    },
  },
  {
    name: "星形 hub",
    graph: {
      nodes: nodes("hub", "a", "b", "c", "d", "e", "f"),
      edges: edges("hub -> a", "hub -> b", "hub -> c", "hub -> d", "hub -> e", "hub -> f"),
    },
  },
  {
    name: "带环",
    graph: {
      nodes: nodes("start", "fetch", "parse", "validate", "retry", "store", "done"),
      edges: edges(
        "start -> fetch",
        "fetch -> parse",
        "parse -> validate",
        "validate -> retry",
        "retry -> fetch",
        "validate -> store",
        "store -> done",
      ),
    },
  },
];
