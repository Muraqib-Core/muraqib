/**
 * Types and helpers shared by the Docker scanner modules.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ScanIssueInput } from "../../core/findings/finding.js";

const execFileAsync = promisify(execFile);
const TIMEOUT = 10_000;
const MAX_OUTPUT = 2 * 1024 * 1024;

export type ComposeDocument = { services?: Record<string, Record<string, unknown>> };

export type DockerCommand = (args: string[], cwd: string) => Promise<string>;

export function safeName(name: string): string {
  return name.replace(/[^\w./-]/g, "_").slice(0, 180);
}

export async function defaultDocker(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("docker", args, { cwd, timeout: TIMEOUT, maxBuffer: MAX_OUTPUT });
  return result.stdout;
}

export function instructions(content: string): Array<{ text: string; line: number }> {
  const result: Array<{ text: string; line: number }> = [];
  let current = "";
  let start = 1;
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    const trimmed = raw.trim();
    if (!current) start = index + 1;
    if (!trimmed || trimmed.startsWith("#")) continue;
    const continuation = trimmed.endsWith("\\");
    current += (current ? " " : "") + (continuation ? trimmed.slice(0, -1).trim() : trimmed);
    if (!continuation) {
      result.push({ text: current, line: start });
      current = "";
    }
  }
  if (current) result.push({ text: current, line: start });
  return result;
}

export interface ScanState {
  findings: ScanIssueInput[];
  diagnostics: string[];
  scannedInputs: string[];
  skippedInputs: string[];
  partial: boolean;
}
