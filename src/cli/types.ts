/**
 * CLI Types and Interfaces
 */

export type OutputFormat = "json" | "text" | "html" | "csv";

export interface CliOptions {
  projectRoot: string;
  format: OutputFormat;
  output?: string;
  verbose: boolean;
  modules?: string[];
  failOnWarning: boolean;
}

export interface AuditReport {
  timestamp: number;
  projectRoot: string;
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  modules: Record<string, unknown>;
}
