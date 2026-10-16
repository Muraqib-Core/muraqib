import path from "node:path";
import type { ProjectContext } from "../context/project-context.js";
import { FindingCollector } from "../findings/finding-collector.js";
import { createScanIssue, type ScanIssue } from "../findings/finding.js";
import { parseEnvFile } from "../parsers/env-parser.js";
import { createEnv } from "../../guard/env-validator.js";
import { EnvValidationError } from "../../guard/errors/env-validation-error.js";
import { OsvScanner } from "../../scanners/dependency/osv-engine.js";
import { CompatibilityEngine } from "../../scanners/compatibility/compatibility-engine.js";
import { DockerScanner } from "../../scanners/docker/docker-engine.js";
import { analyzeUnknownVariablesWithAi } from "../../../ai/fallback.js";
import { generateFindingsAdvisory } from "../../../ai/advisor.js";
import type { ValidationEngineName } from "../../guard/core/engine-detector.js";
import type { ScanContext, ScanResult, ScanStatus, ScannerEngine } from "../contracts/scanner-engine.js";

export interface ScannerCoverage {
  scanner: string;
  status: ScanStatus;
  scannedInputs: string[];
  skippedInputs: string[];
  diagnostics: string[];
}

export interface AuditOptions {
  mode?: "build" | "prod" | undefined;
  engine?: ValidationEngineName | undefined;
  enableAi?: boolean | undefined;
  dockerNative?: boolean | undefined;
}

export interface AuditReport {
  findings: ScanIssue[];
  totalParsedLines: number;
  engine: string;
  mode: "build" | "prod";
  scannedEnvFiles: string[];
  aiAdvisory: string | null;
  scannerCoverage: ScannerCoverage[];
  hasBlockingIssues: boolean;
  exitCode: number;
}

type EnvMeta = { fileName: string; line: number };
type EnvMetaRegistry = Record<string, EnvMeta>;

interface ParsedEnvFiles {
  cleanEnv: Record<string, string>;
  registry: EnvMetaRegistry;
  totalParsedLines: number;
}

/** Parses every .env file, collecting parser findings and where each key was defined. */
function parseEnvFiles(context: ProjectContext, collector: FindingCollector): ParsedEnvFiles {
  const registry: EnvMetaRegistry = {};
  let cleanEnv: Record<string, string> = {};
  let totalParsedLines = 0;
  for (const file of context.envFiles) {
    const fullPath = path.join(context.projectPath, file);
    try {
      const result = parseEnvFile(fullPath);
      totalParsedLines += result.parsedLines.length;
      cleanEnv = { ...cleanEnv, ...result.parsedData };
      result.parsedLines.forEach((p) => {
        registry[p.key] = { fileName: file, line: p.line };
      });
      collector.addMany(result.findings);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read environment file ${file}: ${msg}`, { cause: err });
    }
  }
  return { cleanEnv, registry, totalParsedLines };
}

/** The first path segment of a validation error, and where that key was defined. */
function locateField(segments: string[], registry: EnvMetaRegistry): { field: string; meta: EnvMeta } {
  const field = segments[0] ?? "UNKNOWN";
  return { field, meta: registry[field] ?? { fileName: ".env", line: 0 } };
}

interface SemanticValidation {
  engine: string;
  unknownKeys: string[];
}

/** Runs the schema engine over the merged env; preset violations become findings. */
async function validateSemantics(
  parsed: ParsedEnvFiles,
  options: AuditOptions,
  projectPath: string,
  collector: FindingCollector
): Promise<SemanticValidation> {
  const fallback: SemanticValidation = { engine: options.engine ?? "custom", unknownKeys: [] };
  if (Object.keys(parsed.cleanEnv).length === 0) return fallback;
  try {
    const guardResult = await createEnv({
      runtimeEnvStrict: parsed.cleanEnv,
      emptyStringAsUndefined: true,
      engine: options.engine,
      projectRoot: projectPath,
    });
    return { engine: guardResult.engine, unknownKeys: guardResult.unknownKeys };
  } catch (err: unknown) {
    if (!(err instanceof EnvValidationError)) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Environment validation execution failed: ${msg}`, { cause: err });
    }
    for (const valErr of err.errors) {
      const { field, meta } = locateField(valErr.path, parsed.registry);
      collector.add(createScanIssue({
        id: `preset-violation-${field}`,
        title: `Preset Violation: ${field}`,
        message: valErr.message,
        severity: "high",
        category: "validation",
        source: `preset-guard (${err.engine})`,
        file: meta.fileName,
        line: meta.line,
        key: field,
      }));
    }
    return { engine: err.engine, unknownKeys: err.unknownKeys };
  }
}

/** Asks the AI fallback about variables the schema does not know. */
async function addAiUnknownVariableFindings(
  unknownKeys: string[],
  parsed: ParsedEnvFiles,
  collector: FindingCollector
): Promise<void> {
  const aiErrors = await analyzeUnknownVariablesWithAi(unknownKeys, parsed.cleanEnv);
  for (const err of aiErrors) {
    const { field, meta } = locateField(err.path, parsed.registry);
    collector.add(createScanIssue({
      id: `ai-finding-${field}`,
      title: `AI Configuration Finding: ${field}`,
      message: err.message,
      severity: "medium",
      category: "security",
      source: "ai-advisor",
      confidence: "advisory",
      file: meta.fileName,
      line: meta.line,
      key: field,
    }));
  }
}

/** How one scanner's failed/partial outcomes are reported. `partial` is absent when partial is not flagged. */
interface ScannerSpec {
  create: (options: AuditOptions) => ScannerEngine;
  /** Overrides the issue `source` (defaults to the scanner's name). */
  source?: string;
  failed: { id: string; title: string; message: string };
  partial?: { id: string; title: string; message: string };
}

const SCANNER_SPECS: readonly ScannerSpec[] = [
  {
    create: () => new OsvScanner(),
    source: "osv",
    failed: { id: "scanner-osv-failed", title: "OSV scan failed", message: "OSV scan failed." },
    partial: {
      id: "scanner-osv-partial",
      title: "OSV scan completed partially",
      message: "Some dependencies were not verified by OSV.",
    },
  },
  {
    create: () => new CompatibilityEngine(),
    failed: {
      id: "scanner-compat-failed",
      title: "Compatibility scanner failed",
      message: "Compatibility scanner failed.",
    },
  },
  {
    create: (options) => new DockerScanner(undefined, options.dockerNative === true),
    failed: { id: "scanner-docker-failed", title: "Docker scanner failed", message: "Docker scanner failed." },
    partial: {
      id: "scanner-docker-partial",
      title: "Docker scan completed partially",
      message: "Some Docker files were not verified.",
    },
  },
];

function reliabilityIssue(
  kind: { id: string; title: string; message: string },
  severity: "high" | "medium",
  source: string,
  result: ScanResult
): ScanIssue {
  return createScanIssue({
    id: kind.id,
    title: kind.title,
    message: result.error ?? kind.message,
    severity,
    category: "reliability",
    source,
    confidence: "confirmed",
    evidence: (result.diagnostics ?? []).join(" "),
  });
}

/** Runs one scanner if it applies, recording its coverage and any failure/partial findings. */
async function runScanner(
  spec: ScannerSpec,
  options: AuditOptions,
  scanContext: ScanContext,
  collector: FindingCollector,
  scannerCoverage: ScannerCoverage[]
): Promise<void> {
  const scanner = spec.create(options);
  if (!scanner.supports(scanContext)) return;
  const result = await scanner.scan(scanContext);
  scannerCoverage.push({
    scanner: scanner.name,
    status: result.status,
    scannedInputs: result.scannedInputs ?? [],
    skippedInputs: result.skippedInputs ?? [],
    diagnostics: result.diagnostics ?? [],
  });
  const source = spec.source ?? scanner.name;
  if (result.status === "failed") {
    collector.add(reliabilityIssue(spec.failed, "high", source, result));
    return;
  }
  collector.addMany(result.findings);
  if (result.status === "partial" && spec.partial) {
    collector.add(reliabilityIssue(spec.partial, "medium", source, result));
  }
}

/** Exit code 3 when a scanner failed or was unavailable, 1 for blocking findings, else 0. */
function exitCodeFor(scannerCoverage: readonly ScannerCoverage[], hasBlockingIssues: boolean): number {
  if (scannerCoverage.some((c) => c.status === "failed" || c.status === "unavailable")) return 3;
  return hasBlockingIssues ? 1 : 0;
}

/**
 * Audit runner class.
 */
export class AuditRunner {
  /**
   * Run.
   *
   * @param context - Context
   * @param options - Options
   * @returns Run result
   */
  async run(context: ProjectContext, options: AuditOptions = {}): Promise<AuditReport> {
    const collector = new FindingCollector();
    const scannerCoverage: ScannerCoverage[] = [];

    // 1. Parse .env files
    const parsed = parseEnvFiles(context, collector);

    // 2. Semantic validation
    const { engine, unknownKeys } = await validateSemantics(parsed, options, context.projectPath, collector);

    // 3. AI Unknown Variables Fallback (if enabled and key present)
    const canUseAi = options.enableAi === true && Boolean(process.env.GEMINI_API_KEY);
    if (unknownKeys.length > 0 && canUseAi) {
      await addAiUnknownVariableFindings(unknownKeys, parsed, collector);
    }

    // 4. Scanner Engines (OSV + Compatibility + Docker)
    const scanContext = {
      projectPath: context.projectPath,
      files: context.files,
      packageManager: context.packageManager,
      dependencies: context.dependencies,
      devDependencies: context.devDependencies,
      dockerfiles: context.dockerfiles,
      composeFiles: context.composeFiles,
      dockerignoreFiles: context.dockerignoreFiles,
    };
    for (const spec of SCANNER_SPECS) {
      await runScanner(spec, options, scanContext, collector, scannerCoverage);
    }

    const allFindings = collector.getAll();

    // 5. AI Remediation Advisory for Security Findings
    let aiAdvisory: string | null = null;
    const securityFindings = collector.getByCategory("security");
    if (securityFindings.length > 0 && canUseAi) {
      aiAdvisory = await generateFindingsAdvisory(securityFindings, {
        ...context.dependencies,
        ...context.devDependencies,
      });
    }

    const mode = options.mode ?? "build";
    const hasBlockingIssues = collector.hasBlockingIssues(mode === "prod" ? "medium" : "high");

    return {
      findings: allFindings,
      totalParsedLines: parsed.totalParsedLines,
      engine,
      mode,
      scannedEnvFiles: context.envFiles,
      aiAdvisory,
      scannerCoverage,
      hasBlockingIssues,
      exitCode: exitCodeFor(scannerCoverage, hasBlockingIssues),
    };
  }
}
