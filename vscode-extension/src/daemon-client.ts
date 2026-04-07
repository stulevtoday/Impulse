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
