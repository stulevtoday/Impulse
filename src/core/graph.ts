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

export class DependencyGraph {
  private nodes = new Map<string, GraphNode>();
  private forwardEdges = new Map<string, GraphEdge[]>();
  private reverseEdges = new Map<string, GraphEdge[]>();

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  /** Full removal: drops all edges (forward and reverse) involving this node. */
  removeNode(id: string): void {
    this.nodes.delete(id);
    this.forwardEdges.delete(id);
    this.reverseEdges.delete(id);

    for (const [key, edges] of this.forwardEdges) {
      this.forwardEdges.set(key, edges.filter((e) => e.to !== id));
    }
    for (const [key, edges] of this.reverseEdges) {
      this.reverseEdges.set(key, edges.filter((e) => e.from !== id));
    }
  }

  /**
   * Incremental removal for file updates: drops only outgoing edges
   * and owned nodes, preserving incoming edges from other files.
   */
  removeFileOutgoing(filePath: string): void {
    const ownedIds: string[] = [];
    for (const node of this.nodes.values()) {
      if (node.filePath === filePath) ownedIds.push(node.id);
    }

    for (const id of ownedIds) {
      this.nodes.delete(id);

      const forward = this.forwardEdges.get(id) ?? [];
      for (const edge of forward) {
        const rev = this.reverseEdges.get(edge.to);
        if (rev) {
          this.reverseEdges.set(edge.to, rev.filter((e) => e.from !== id));
        }
      }
      this.forwardEdges.delete(id);
    }
  }

  addEdge(edge: GraphEdge): void {
    const forward = this.forwardEdges.get(edge.from) ?? [];
    forward.push(edge);
    this.forwardEdges.set(edge.from, forward);

    const reverse = this.reverseEdges.get(edge.to) ?? [];
    reverse.push(edge);
    this.reverseEdges.set(edge.to, reverse);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getDependencies(id: string): GraphEdge[] {
    return this.forwardEdges.get(id) ?? [];
  }

  getDependents(id: string): GraphEdge[] {
    return this.reverseEdges.get(id) ?? [];
  }

  getNodesByFile(filePath: string): GraphNode[] {
    const result: GraphNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.filePath === filePath) result.push(node);
    }
    return result;
  }

  removeFileNodes(filePath: string): void {
    const toRemove = this.getNodesByFile(filePath);
    for (const node of toRemove) {
      this.removeNode(node.id);
    }
  }

  /**
   * BFS traversal up the reverse edges: given a node,
   * find everything that transitively depends on it.
   */
  analyzeImpact(nodeId: string, maxDepth = 10): ImpactResult {
    const affected: ImpactResult["affected"] = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number; path: string[] }> = [
      { id: nodeId, depth: 0, path: [nodeId] },
    ];

    visited.add(nodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > maxDepth) continue;

      const dependents = this.getDependents(current.id);
      for (const edge of dependents) {
        if (visited.has(edge.from)) continue;
        visited.add(edge.from);

        const node = this.nodes.get(edge.from);
        if (!node) continue;

        const path = [...current.path, edge.from];
        affected.push({ nodeId: edge.from, node, depth: current.depth + 1, path });
        queue.push({ id: edge.from, depth: current.depth + 1, path });
      }
    }

    return { changed: nodeId, affected };
  }

  /** Impact analysis starting from a file path — affects all nodes in that file. */
  analyzeFileImpact(filePath: string, maxDepth = 10): ImpactResult {
    const fileNodes = this.getNodesByFile(filePath);
    const merged: ImpactResult = { changed: filePath, affected: [] };
    const seen = new Set<string>();

    for (const node of fileNodes) {
      const result = this.analyzeImpact(node.id, maxDepth);
      for (const item of result.affected) {
        if (!seen.has(item.nodeId)) {
          seen.add(item.nodeId);
          merged.affected.push(item);
        }
      }
    }

    merged.affected.sort((a, b) => a.depth - b.depth);
    return merged;
  }

  get stats() {
    let edgeCount = 0;
    let fileCount = 0;
    let exportCount = 0;
    for (const edges of this.forwardEdges.values()) edgeCount += edges.length;
    for (const node of this.nodes.values()) {
      if (node.kind === "file") fileCount++;
      else if (node.kind === "export") exportCount++;
    }
    return { nodes: this.nodes.size, edges: edgeCount, files: fileCount, exports: exportCount };
  }

  allNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  allEdges(): GraphEdge[] {
    const result: GraphEdge[] = [];
    for (const edges of this.forwardEdges.values()) result.push(...edges);
    return result;
  }

  serialize(): SerializedGraph {
    const nodes: Record<string, GraphNode> = {};
    for (const [id, node] of this.nodes) nodes[id] = node;
    return { nodes, edges: this.allEdges() };
  }

  static deserialize(data: SerializedGraph): DependencyGraph {
    const graph = new DependencyGraph();
    for (const node of Object.values(data.nodes)) graph.addNode(node);
    for (const edge of data.edges) graph.addEdge(edge);
    return graph;
  }
}
