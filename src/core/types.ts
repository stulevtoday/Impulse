import type { GraphNode, GraphEdge } from "./graph-types.js";
import type { PathAlias } from "./tsconfig.js";
import type { WorkspacePackage } from "./workspaces.js";

export interface ExtractionResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ExtractorContext {
  rootDir: string;
  aliases: PathAlias[];
  workspaceMap?: Map<string, WorkspacePackage>;
}
