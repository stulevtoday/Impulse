export type { GraphNode, GraphEdge, ImpactResult, SerializedGraph } from "./graph-types.js";
import type { GraphNode, GraphEdge, ImpactResult, SerializedGraph } from "./graph-types.js";

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

  /** Get all export nodes for a given file (includes importer-created nodes). */
  getFileExports(filePath: string): GraphNode[] {
    const result: GraphNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.kind === "export" && node.filePath === filePath) {
        result.push(node);
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get only exports actually declared by the file itself (connected via
   * an `exports` edge from the file node). Excludes phantom nodes created
   * by importers that reference non-existent exports.
   */
  getDeclaredExports(filePath: string): GraphNode[] {
    const fileId = `file:${filePath}`;
    const forward = this.getDependencies(fileId);
    const result: GraphNode[] = [];

    for (const edge of forward) {
      if (edge.kind !== "exports") continue;
      const node = this.nodes.get(edge.to);
      if (node && node.kind === "export") result.push(node);
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Symbol-level impact: follows uses_export chains precisely through
   * barrel re-exports, then does file-level BFS from actual consumers.
   *
   * Phase 1: trace uses_export edges, hopping through re-export nodes
   *          in barrel files instead of fanning out via file imports.
   * Phase 2: from the set of genuine consumers, standard file-level BFS.
   */
  analyzeExportImpact(filePath: string, exportName: string, maxDepth = 10): ImpactResult {
    const startId = `export:${filePath}:${exportName}`;
    if (!this.nodes.has(startId)) {
      return { changed: `${filePath}:${exportName}`, affected: [] };
    }

    const affected: ImpactResult["affected"] = [];
    const visited = new Set<string>();

    // Phase 1 — follow uses_export chains through re-exports
    const directConsumers = new Set<string>();
    const exportQueue: string[] = [startId];
    const visitedExports = new Set<string>([startId]);

    while (exportQueue.length > 0) {
      const eid = exportQueue.shift()!;
      const users = this.getDependents(eid).filter((e) => e.kind === "uses_export");

      for (const edge of users) {
        const userNode = this.nodes.get(edge.from);
        if (!userNode || userNode.kind !== "file") continue;

        directConsumers.add(edge.from);

        const reExportId = `export:${userNode.filePath}:${exportName}`;
        if (this.nodes.has(reExportId) && !visitedExports.has(reExportId)) {
          visitedExports.add(reExportId);
          exportQueue.push(reExportId);
        }
      }
    }

    // Phase 2 — file-level BFS from direct consumers
    const queue: Array<{ id: string; depth: number; path: string[] }> = [];

    for (const fileId of directConsumers) {
      if (visited.has(fileId)) continue;
      visited.add(fileId);
      const node = this.nodes.get(fileId);
      if (!node) continue;
      affected.push({ nodeId: fileId, node, depth: 1, path: [startId, fileId] });
      queue.push({ id: fileId, depth: 1, path: [startId, fileId] });
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      for (const edge of this.getDependents(current.id)) {
        if (visited.has(edge.from)) continue;
        visited.add(edge.from);
        const node = this.nodes.get(edge.from);
        if (!node) continue;
        const path = [...current.path, edge.from];
        affected.push({ nodeId: edge.from, node, depth: current.depth + 1, path });
        queue.push({ id: edge.from, depth: current.depth + 1, path });
      }
    }

    affected.sort((a, b) => a.depth - b.depth);
    return { changed: `${filePath}:${exportName}`, affected };
  }

  /**
   * Multi-symbol impact: union of precise symbol-level analysis for
   * several exports. Returns per-symbol breakdown.
   */
  analyzeExportsImpact(
    filePath: string,
    exportNames: string[],
    maxDepth = 10,
  ): { merged: ImpactResult; perSymbol: Map<string, ImpactResult> } {
    const perSymbol = new Map<string, ImpactResult>();
    const merged: ImpactResult = {
      changed: `${filePath}:[${exportNames.join(",")}]`,
      affected: [],
    };
    const seen = new Set<string>();

    for (const name of exportNames) {
      const result = this.analyzeExportImpact(filePath, name, maxDepth);
      perSymbol.set(name, result);

      for (const item of result.affected) {
        if (!seen.has(item.nodeId)) {
          seen.add(item.nodeId);
          merged.affected.push(item);
        }
      }
    }

    merged.affected.sort((a, b) => a.depth - b.depth);
    return { merged, perSymbol };
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
