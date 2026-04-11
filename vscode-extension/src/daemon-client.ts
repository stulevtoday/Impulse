import * as http from "http";

export interface DaemonStatus {
  ready: boolean;
  rootDir: string | null;
  nodes: number;
  edges: number;
  warnings: number;
}

export interface ImpactResult {
  changed: string;
  affected: Array<{ file: string; depth: number; kind: string }>;
  count: number;
}

export interface FileEntry {
  file: string;
  imports: number;
  importedBy: number;
}

export interface DependencyEntry {
  target: string;
  kind: string;
  external: boolean;
}

export interface DependentEntry {
  source: string;
  kind: string;
}

export interface HealthResult {
  score: number;
  grade: string;
  summary: string;
  penalties: {
    cycles: number;
    godFiles: number;
    deepChains: number;
    orphans: number;
    hubConcentration: number;
  };
  cycles: Array<{ cycle: string[]; length: number; severity: string }>;
  godFiles: Array<{ file: string; importedBy: number; imports: number; totalConnections: number }>;
  orphans: string[];
  stats: {
    totalFiles: number;
    avgImports: number;
    avgImportedBy: number;
    maxImports: number;
    maxImportedBy: number;
    localEdges: number;
    externalEdges: number;
  };
}

export interface FocusExport {
  name: string;
  consumers: string[];
  dead: boolean;
}

export interface FocusResult {
  file: string;
  exists: boolean;
  imports: string[];
  importedBy: string[];
  exports: FocusExport[];
  blastRadius: number;
  impactByDepth: Record<number, number>;
  testsCovering: string[];
  gitChanges: number;
  lastChanged: string | null;
}

export interface ReviewResult {
  changedFiles: string[];
  totalAffected: number;
  files: Array<{ file: string; riskScore: number; riskLevel: string; blastRadius: number }>;
  secretIssues: Array<{ severity: string; category: string; message: string; file?: string; variable?: string }>;
  verdict: { level: string; reasons: string[] };
  durationMs: number;
}

export interface ExplainResult {
  file?: string;
  summary: string;
  sections: Array<{ heading: string; lines: string[] }>;
}

export interface SecretsResult {
  issues: Array<{ severity: string; category: string; message: string; file?: string; variable?: string }>;
  envFilesExposed: string[];
  framework: string | null;
}

export interface OwnersResult {
  file?: string;
  topAuthors?: Array<{ name: string; commits: number; share: number }>;
  busFactor?: number;
  totalAuthors?: number;
}

export class DaemonClient {
  constructor(private port: number) {}

  async status(): Promise<DaemonStatus> {
    return this.get("/status");
  }

  async impact(file: string, depth = 10): Promise<ImpactResult> {
    return this.get(`/impact?file=${encodeURIComponent(file)}&depth=${depth}`);
  }

  async files(): Promise<{ count: number; files: FileEntry[] }> {
    return this.get("/files");
  }

  async dependencies(file: string): Promise<{ file: string; dependencies: DependencyEntry[] }> {
    return this.get(`/dependencies?file=${encodeURIComponent(file)}`);
  }

  async dependents(file: string): Promise<{ file: string; dependents: DependentEntry[] }> {
    return this.get(`/dependents?file=${encodeURIComponent(file)}`);
  }

  async health(): Promise<HealthResult> {
    return this.get("/health");
  }

  async focus(file: string): Promise<FocusResult> {
    return this.get(`/focus?file=${encodeURIComponent(file)}`);
  }

  async review(): Promise<ReviewResult> {
    return this.get("/review");
  }

  async explain(file?: string): Promise<ExplainResult> {
    const q = file ? `?file=${encodeURIComponent(file)}` : "";
    return this.get(`/explain${q}`);
  }

  async secrets(): Promise<SecretsResult> {
    return this.get("/secrets");
  }

  async owners(file?: string): Promise<OwnersResult> {
    const q = file ? `?file=${encodeURIComponent(file)}` : "";
    return this.get(`/owners${q}`);
  }

  async isRunning(): Promise<boolean> {
    try {
      const status = await this.status();
      return status.ready;
    } catch {
      return false;
    }
  }

  private get<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        { hostname: "localhost", port: this.port, path, timeout: 3000 },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(new Error(`Invalid JSON from daemon: ${data.slice(0, 100)}`));
            }
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Daemon request timed out"));
      });
    });
  }
}
