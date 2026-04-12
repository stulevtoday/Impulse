import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import type { DependencyGraph } from "./graph.js";
import { loadEnvFiles } from "./env.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type IssueSeverity = "critical" | "warning" | "info";

export interface SecretIssue {
  severity: IssueSeverity;
  category: "client-exposed" | "gitignore" | "weak-default" | "hardcoded" | "known-credential";
  message: string;
  file?: string;
  variable?: string;
}

export interface SecretsReport {
  issues: SecretIssue[];
  envFilesFound: string[];
  envFilesIgnored: string[];
  envFilesExposed: string[];
  framework: string | null;
  clientPrefix: string | null;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Secret name patterns — derived from envtypes conventions
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /SECRET/i, /PASSWORD/i, /PASSWD/i, /TOKEN/i,
  /PRIVATE[_-]?KEY/i, /API[_-]?KEY/i, /AUTH[_-]?KEY/i,
  /CREDENTIAL/i, /ACCESS[_-]?KEY/i,
];

const KNOWN_SECRETS = new Set([
  "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "GITHUB_TOKEN", "GH_TOKEN",
  "SLACK_TOKEN", "SLACK_SIGNING_SECRET",
  "SENDGRID_API_KEY",
  "TWILIO_AUTH_TOKEN",
  "DATABASE_URL", "REDIS_URL", "MONGODB_URI", "MONGO_URL",
  "JWT_SECRET", "SESSION_SECRET", "ENCRYPTION_KEY",
  "PRIVATE_KEY", "SSH_KEY",
]);

const WEAK_DEFAULTS = new Set([
  "changeme", "change_me", "change-me",
  "secret", "password", "123456", "admin",
  "test", "default", "example", "todo",
  "fixme", "replace_me", "replace-me",
  "your_secret_here", "your-secret-here",
  "xxx", "placeholder",
]);

// ---------------------------------------------------------------------------
// Framework → client prefix mapping (from envtypes)
// ---------------------------------------------------------------------------

interface FrameworkInfo {
  name: string;
  clientPrefix: string;
  detectDep: string;
}

const FRAMEWORKS: FrameworkInfo[] = [
  { name: "next", clientPrefix: "NEXT_PUBLIC_", detectDep: "next" },
  { name: "vite", clientPrefix: "VITE_", detectDep: "vite" },
  { name: "astro", clientPrefix: "PUBLIC_", detectDep: "astro" },
  { name: "nuxt", clientPrefix: "NUXT_PUBLIC_", detectDep: "nuxt" },
  { name: "cra", clientPrefix: "REACT_APP_", detectDep: "react-scripts" },
  { name: "expo", clientPrefix: "EXPO_PUBLIC_", detectDep: "expo" },
];

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function analyzeSecrets(
  graph: DependencyGraph,
  rootDir: string,
): Promise<SecretsReport> {
  const start = performance.now();

  const framework = await detectFramework(rootDir);
  const clientPrefix = framework
    ? FRAMEWORKS.find((f) => f.name === framework)?.clientPrefix ?? null
    : null;

  const presentEnvFiles = findEnvFiles(rootDir);
  const gitignorePatterns = await loadGitignorePatterns(rootDir);
  const { ignored: envFilesIgnored, exposed: envFilesExposed, issues: gitignoreIssues } = auditGitignore(presentEnvFiles, gitignorePatterns);

  const envDefs = await loadEnvFiles(rootDir);
  const envValues = await loadEnvValues(rootDir, presentEnvFiles);

  const issues: SecretIssue[] = [
    ...gitignoreIssues,
    ...checkWeakDefaults(envValues),
    ...checkClientExposure(graph, envDefs, clientPrefix),
    ...checkKnownCredentials(envDefs, presentEnvFiles, gitignorePatterns),
  ];

  issues.sort((a, b) => {
    const sev = { critical: 0, warning: 1, info: 2 };
    return sev[a.severity] - sev[b.severity];
  });

  return {
    issues,
    envFilesFound: presentEnvFiles,
    envFilesIgnored,
    envFilesExposed,
    framework,
    clientPrefix,
    durationMs: Math.round(performance.now() - start),
  };
}

// ---------------------------------------------------------------------------
// Individual checks — each returns SecretIssue[]
// ---------------------------------------------------------------------------

const ENV_FILENAMES = [".env", ".env.local", ".env.development", ".env.staging", ".env.production", ".env.test"];

function findEnvFiles(rootDir: string): string[] {
  return ENV_FILENAMES.filter((f) => existsSync(join(rootDir, f)));
}

function auditGitignore(presentEnvFiles: string[], patterns: string[]): {
  ignored: string[]; exposed: string[]; issues: SecretIssue[];
} {
  const ignored: string[] = [];
  const exposed: string[] = [];
  const issues: SecretIssue[] = [];

  for (const f of presentEnvFiles) {
    if (isIgnored(f, patterns)) {
      ignored.push(f);
    } else {
      exposed.push(f);
      if (f !== ".env.example") {
        issues.push({
          severity: "critical", category: "gitignore",
          message: `${f} exists but is NOT in .gitignore — secrets may be committed to git`, file: f,
        });
      }
    }
  }

  return { ignored, exposed, issues };
}

function checkWeakDefaults(envValues: Map<string, string>): SecretIssue[] {
  const issues: SecretIssue[] = [];
  for (const [varName, value] of envValues) {
    if (isSecretName(varName) && value && WEAK_DEFAULTS.has(value.toLowerCase())) {
      issues.push({
        severity: "warning", category: "weak-default",
        message: `${varName} has a weak or placeholder default value "${value}"`, variable: varName,
      });
    }
  }
  return issues;
}

function checkClientExposure(
  graph: DependencyGraph,
  envDefs: Map<string, string[]>,
  clientPrefix: string | null,
): SecretIssue[] {
  if (!clientPrefix) return [];

  const issues: SecretIssue[] = [];
  const reported = new Set<string>();

  for (const node of graph.allNodes()) {
    if (node.kind !== "env_var") continue;
    if (node.name.startsWith(clientPrefix) && isSecretName(node.name) && !reported.has(node.name)) {
      reported.add(node.name);
      issues.push({
        severity: "critical", category: "client-exposed",
        message: `${node.name} is client-exposed (${clientPrefix} prefix) but contains a secret pattern`,
        file: node.filePath, variable: node.name,
      });
    }
  }

  for (const [varName] of envDefs) {
    if (varName.startsWith(clientPrefix) && isSecretName(varName) && !reported.has(varName)) {
      reported.add(varName);
      issues.push({
        severity: "critical", category: "client-exposed",
        message: `${varName} is client-exposed (${clientPrefix} prefix) but contains a secret pattern`,
        variable: varName,
      });
    }
  }

  return issues;
}

function checkKnownCredentials(
  envDefs: Map<string, string[]>,
  presentEnvFiles: string[],
  gitignorePatterns: string[],
): SecretIssue[] {
  const issues: SecretIssue[] = [];
  for (const [varName] of envDefs) {
    if (!KNOWN_SECRETS.has(varName)) continue;
    const inGitignore = presentEnvFiles.every(
      (f) => envDefs.get(varName)?.includes(f) ? isIgnored(f, gitignorePatterns) : true,
    );
    if (!inGitignore) {
      issues.push({
        severity: "warning", category: "known-credential",
        message: `${varName} is a known credential and may be in a tracked .env file`, variable: varName,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSecretName(name: string): boolean {
  if (KNOWN_SECRETS.has(name)) return true;
  return SECRET_PATTERNS.some((p) => p.test(name));
}

async function detectFramework(rootDir: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(
      await readFile(join(rootDir, "package.json"), "utf-8"),
    );
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    for (const fw of FRAMEWORKS) {
      if (fw.detectDep in allDeps) return fw.name;
    }
  } catch {
    // no package.json
  }
  return null;
}

async function loadGitignorePatterns(rootDir: string): Promise<string[]> {
  try {
    const content = await readFile(join(rootDir, ".gitignore"), "utf-8");
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

function isIgnored(filename: string, patterns: string[]): boolean {
  const name = basename(filename);
  for (const pattern of patterns) {
    if (pattern === name) return true;
    if (pattern === filename) return true;
    if (pattern.endsWith("*") && name.startsWith(pattern.slice(0, -1))) return true;
    if (pattern === ".env*" || pattern === ".env.*") {
      if (name.startsWith(".env")) return true;
    }
    if (pattern === "*.env" && name.endsWith(".env")) return true;
  }
  return false;
}

async function loadEnvValues(
  rootDir: string,
  files: string[],
): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  for (const filename of files) {
    try {
      const content = await readFile(join(rootDir, filename), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 1) continue;
        const name = trimmed.slice(0, eqIdx).trim().replace(/^export\s+/, "");
        let value = trimmed.slice(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!values.has(name)) values.set(name, value);
      }
    } catch {
      continue;
    }
  }
  return values;
}
