import type { GraphNode, GraphEdge } from "./graph-types.js";
import type { PathAlias } from "./tsconfig.js";

export interface ExtractionResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ExtractorContext {
  rootDir: string;
  aliases: PathAlias[];
}
