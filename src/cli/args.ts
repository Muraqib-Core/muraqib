/**
 * CLI argument parsing: flag table, command words and project-root resolution.
 */
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import type { CliOptions, OutputFormat } from "./types.js";
import type { ValidationEngineName } from "../scan/guard/core/engine-detector.js";
import { nonEmpty } from "../utils/defaults.js";
import { printHelp } from "./help.js";
import { readPackageVersion } from "./package-version.js";

export interface ExtendedCliOptions extends Partial<CliOptions> {
  command?: "audit" | "resolve" | "agent" | "context" | "tool-schema";
  dockerNative?: boolean;
  maxIssues?: number;
  interactive?: boolean;
  osv?: boolean;
  docker?: boolean;
  aiAdvisory?: boolean;
  env?: "build" | "prod";
  engine?: ValidationEngineName;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  securityUrl?: string | undefined;
}

const VALIDATION_ENGINES: readonly ValidationEngineName[] = ["custom", "zod", "valibot", "arktype"];
function isValidationEngine(value: string | undefined): value is ValidationEngineName {
  return VALIDATION_ENGINES.some((engine) => engine === value);
}

/**
 * Expand a leading `~` (shells such as PowerShell/cmd leave it untouched) and make sure the
 * project root is an existing directory, so a typo fails fast instead of producing a bogus report.
 */
export function resolveProjectRoot(raw: string): string {
  const expanded = raw === "~" || /^~[\\/]/.test(raw) ? resolve(homedir(), raw.slice(2)) : resolve(raw);
  if (!existsSync(expanded) || !statSync(expanded).isDirectory()) {
    throw new Error(`Project path not found or not a directory: ${expanded}`);
  }
  return expanded;
}

const COMMAND_WORDS: ReadonlyMap<string, NonNullable<ExtendedCliOptions["command"]>> = new Map([
  ["resolve", "resolve"],
  ["audit", "audit"],
  ["agent", "agent"],
  ["context", "context"],
  ["tool-schema", "tool-schema"],
]);

/** Applies a flag to `options`; `value` is the next argument. Returns how many extra arguments it consumed. */
type FlagHandler = (options: ExtendedCliOptions, value: string | undefined) => number;

/** A flag that takes no value. */
const switchFlag = (apply: (options: ExtendedCliOptions) => void): FlagHandler => (options) => {
  apply(options);
  return 0;
};

/** A flag that always consumes the next argument. */
const valueFlag = (apply: (options: ExtendedCliOptions, value: string | undefined) => void): FlagHandler =>
  (options, value) => {
    apply(options, value);
    return 1;
  };

/** Exits the process; typed as returning so callers keep parsing if `exit` is stubbed (as in tests). */
function exitProcess(code: number): void {
  process.exit(code);
}

function showHelp(options: ExtendedCliOptions): number {
  printHelp(options.command === "resolve" ? "resolve" : "audit");
  exitProcess(0);
  return 0;
}

/** `--version` means "package version" for `resolve` and "print the CLI version" for `audit`. */
function handleVersion(options: ExtendedCliOptions, value: string | undefined): number {
  if (options.command === "resolve") {
    options.packageVersion = value;
    return 1;
  }
  if (options.command === "audit") {
    console.log(`Muraqib Core v${readPackageVersion()}`);
    exitProcess(0);
  }
  return 0;
}

const FLAG_HANDLERS: ReadonlyMap<string, FlagHandler> = new Map<string, FlagHandler>([
  ["--json", switchFlag((o) => { o.format = "json"; })],
  ["--report", switchFlag((o) => { o.format = "md"; })],
  ["--interactive", switchFlag((o) => { o.interactive = true; })],
  ["-i", switchFlag((o) => { o.interactive = true; })],
  ["--no-interactive", switchFlag((o) => { o.interactive = false; })],
  ["--docker-native", switchFlag((o) => { o.dockerNative = true; })],
  ["--verbose", switchFlag((o) => { o.verbose = true; })],
  ["-v", switchFlag((o) => { o.verbose = true; })],
  ["--fail-on-warning", switchFlag((o) => { o.failOnWarning = true; })],
  ["--osv", switchFlag((o) => { o.osv = true; })],
  ["--docker", switchFlag((o) => { o.docker = true; })],
  ["--ai-advisory", switchFlag((o) => { o.aiAdvisory = true; })],
  ["--max-issues", valueFlag((o, value) => {
    const n = Number.parseInt(value ?? "", 10);
    if (Number.isInteger(n) && n >= 0) o.maxIssues = n;
  })],
  ["--format", formatFlag],
  ["-f", formatFlag],
  ["--output", valueFlag((o, value) => { o.output = value; })],
  ["-o", valueFlag((o, value) => { o.output = value; })],
  ["--project", valueFlag((o, value) => { o.projectRoot = nonEmpty(value, process.cwd()); })],
  ["-p", valueFlag((o, value) => { o.projectRoot = nonEmpty(value, process.cwd()); })],
  ["--modules", valueFlag((o, value) => { o.modules = value?.split(",") ?? []; })],
  ["-m", valueFlag((o, value) => { o.modules = value?.split(",") ?? []; })],
  ["--security-url", valueFlag((o, value) => { o.securityUrl = value; })],
  ["--env", valueFlag(setEnvMode)],
  ["-e", valueFlag(setEnvMode)],
  ["--engine", valueFlag(setEngine)],
  ["--package", valueFlag((o, value) => { o.packageName = value; })],
  ["--version", handleVersion],
  ["--help", showHelp],
  ["-h", showHelp],
]);

const OUTPUT_FORMATS: readonly OutputFormat[] = ["json", "text", "html", "csv", "md"];

/** `--format` consumes its value only when it is a known format (`markdown` is an alias of `md`). */
function formatFlag(options: ExtendedCliOptions, value: string | undefined): number {
  const format = value === "markdown" ? "md" : OUTPUT_FORMATS.find((candidate) => candidate === value);
  if (format === undefined) return 0;
  options.format = format;
  return 1;
}

function setEnvMode(options: ExtendedCliOptions, value: string | undefined): void {
  if (value !== "build" && value !== "prod") {
    throw new Error(`Invalid environment mode '${value ?? ""}'. Expected 'build' or 'prod'.`);
  }
  options.env = value;
}

function setEngine(options: ExtendedCliOptions, value: string | undefined): void {
  if (!isValidationEngine(value)) {
    throw new Error(`Invalid validation engine '${value ?? ""}'. Expected one of: ${VALIDATION_ENGINES.join(", ")}.`);
  }
  options.engine = value;
}

export function parseArgs(args: string[]): ExtendedCliOptions {
  const options: ExtendedCliOptions = {
    format: "text",
    verbose: false,
    failOnWarning: false,
    command: "audit",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const command = COMMAND_WORDS.get(arg);
    if (command) {
      options.command = command;
      continue;
    }
    i += FLAG_HANDLERS.get(arg)?.(options, args[i + 1]) ?? 0;
  }

  options.projectRoot ||= process.cwd();
  return options;
}
