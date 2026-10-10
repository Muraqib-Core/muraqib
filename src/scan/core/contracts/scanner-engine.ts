import type { ScanIssue } from "../findings/finding.js";

export interface ScanContext {
  projectPath: string;
  files: string[];
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dockerfiles?: string[];
  composeFiles?: string[];
  dockerignoreFiles?: string[];
}

export type ScanStatus = "success" | "partial" | "failed" | "unavailable";

export interface ScanResult {
  scanner: string;
  status: ScanStatus;
  findings: ScanIssue[];
  error?: string;
  diagnostics?: string[];
  scannedInputs?: string[];
  skippedInputs?: string[];
}

export interface ScannerEngine {
  readonly name: string;

  supports(context: ScanContext): boolean;

  scan(context: ScanContext): Promise<ScanResult>;
}
