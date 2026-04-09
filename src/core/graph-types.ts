export type NodeKind = "file" | "symbol" | "export" | "route" | "config" | "env_var";

export type EdgeKind =
  | "imports"
  | "exports"
  | "uses_export"
  | "calls"
  | "defines_route"
  | "reads_env"
  | "references";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  filePath: string;
  name: string;
  line?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  metadata?: Record<string, unknown>;
}

export interface ImpactResult {
  changed: string;
  affected: Array<{
    nodeId: string;
    node: GraphNode;
    depth: number;
    path: string[];
  }>;
}

export interface SerializedGraph {
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
}
