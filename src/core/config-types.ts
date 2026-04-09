export interface BoundaryRule {
  path: string;
  allow: string[];
}

export interface ImpulseConfig {
  exclude?: string[];
  boundaries?: Record<string, BoundaryRule>;
  thresholds?: {
    health?: number;
    maxChainDepth?: number;
  };
}
