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
import { analyzeUnknownVariablesWithAi } from "../../ai/fallback.js";
import { generateAdvisory } from "../../ai/advisor.js";
import type { ValidationEngineName } from "../../guard/core/engine-detector.js";
import type { ScanStatus } from "../contracts/scanner-engine.js";

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

export class AuditRunner {
  async run(context: ProjectContext, options: AuditOptions = {}): Promise<AuditReport> {
    const collector = new FindingCollector();
    const envMetaDataRegistry: Record<string, { fileName: string; line: number }> = {};
    let accumulatedCleanEnv: Record<string, string> = {};
    let totalParsedLines = 0;
    const scannerCoverage: ScannerCoverage[] = [];

    // 1. Parse .env files
    for (const file of context.envFiles) {
      const fullPath = path.join(context.projectPath, file);
      try {
        const result = parseEnvFile(fullPath);
        totalParsedLines += result.parsedLines.length;

        accumulatedCleanEnv = { ...accumulatedCleanEnv, ...result.parsedData };

        result.parsedLines.forEach((p) => {
          envMetaDataRegistry[p.key] = { fileName: file, line: p.line };
        });

        collector.addMany(result.findings);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read environment file ${file}: ${msg}`);
      }
    }

    // 2. Semantic validation
    let activeEngineName: string = options.engine ?? "custom";
    let unknownKeys: string[] = [];

    if (Object.keys(accumulatedCleanEnv).length > 0) {
      try {
        const guardResult = await createEnv({
          runtimeEnvStrict: accumulatedCleanEnv,
          emptyStringAsUndefined: true,
          engine: options.engine,
          projectRoot: context.projectPath,
        });

        activeEngineName = guardResult.engine;
        unknownKeys = guardResult.unknownKeys;
      } catch (err: unknown) {
        if (err instanceof EnvValidationError) {
          activeEngineName = err.engine;
          unknownKeys = err.unknownKeys;

          for (const valErr of err.errors) {
            const field = valErr.path[0] ?? "UNKNOWN";
            const meta = envMetaDataRegistry[field] ?? { fileName: ".env", line: 0 };

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
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Environment validation execution failed: ${msg}`);
        }
      }
    }

    // 3. AI Unknown Variables Fallback (if enabled and key present)
    const canUseAi = options.enableAi === true && Boolean(process.env.GEMINI_API_KEY);
    if (unknownKeys.length > 0 && canUseAi) {
      const aiErrors = await analyzeUnknownVariablesWithAi(unknownKeys, accumulatedCleanEnv);
      for (const err of aiErrors) {
        const field = err.path[0] ?? "UNKNOWN";
        const meta = envMetaDataRegistry[field] ?? { fileName: ".env", line: 0 };
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

    // 4. Scanner Engines (OSV + Compatibility)
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

    const osvScanner = new OsvScanner();
    if (osvScanner.supports(scanContext)) {
      const osvResult = await osvScanner.scan(scanContext);
      scannerCoverage.push({
        scanner: osvScanner.name,
        status: osvResult.status,
        scannedInputs: osvResult.scannedInputs ?? [],
        skippedInputs: osvResult.skippedInputs ?? [],
        diagnostics: osvResult.diagnostics ?? [],
      });
      if (osvResult.status === "failed") {
        collector.add(createScanIssue({
          id: "scanner-osv-failed",
          title: "OSV scan failed",
          message: osvResult.error ?? "OSV scan failed.",
          severity: "high",
          category: "reliability",
          source: "osv",
          confidence: "confirmed",
          evidence: (osvResult.diagnostics ?? []).join(" "),
        }));
      } else {
        collector.addMany(osvResult.findings);
        if (osvResult.status === "partial") {
          collector.add(createScanIssue({
            id: "scanner-osv-partial",
            title: "OSV scan completed partially",
            message: osvResult.error ?? "Some dependencies were not verified by OSV.",
            severity: "medium",
            category: "reliability",
            source: "osv",
            confidence: "confirmed",
            evidence: (osvResult.diagnostics ?? []).join(" "),
          }));
        }
      }
    }

    const compatScanner = new CompatibilityEngine();
    if (compatScanner.supports(scanContext)) {
      const compatResult = await compatScanner.scan(scanContext);
      scannerCoverage.push({
        scanner: compatScanner.name,
        status: compatResult.status,
        scannedInputs: compatResult.scannedInputs ?? [],
        skippedInputs: compatResult.skippedInputs ?? [],
        diagnostics: compatResult.diagnostics ?? [],
      });
      if (compatResult.status === "failed") {
        collector.add(createScanIssue({
          id: "scanner-compat-failed",
          title: "Compatibility scanner failed",
          message: compatResult.error ?? "Compatibility scanner failed.",
          severity: "high",
          category: "reliability",
          source: compatScanner.name,
          confidence: "confirmed",
          evidence: (compatResult.diagnostics ?? []).join(" "),
        }));
      } else {
        collector.addMany(compatResult.findings);
      }
    }

    const dockerScanner = new DockerScanner(undefined, options.dockerNative === true);
    if (dockerScanner.supports(scanContext)) {
      const dockerResult = await dockerScanner.scan(scanContext);
      scannerCoverage.push({
        scanner: dockerScanner.name,
        status: dockerResult.status,
        scannedInputs: dockerResult.scannedInputs ?? [],
        skippedInputs: dockerResult.skippedInputs ?? [],
        diagnostics: dockerResult.diagnostics ?? [],
      });
      if (dockerResult.status === "failed") {
        collector.add(createScanIssue({
          id: "scanner-docker-failed",
          title: "Docker scanner failed",
          message: dockerResult.error ?? "Docker scanner failed.",
          severity: "high",
          category: "reliability",
          source: dockerScanner.name,
          confidence: "confirmed",
          evidence: (dockerResult.diagnostics ?? []).join(" "),
        }));
      } else {
        collector.addMany(dockerResult.findings);
        if (dockerResult.status === "partial") {
          collector.add(createScanIssue({
            id: "scanner-docker-partial",
            title: "Docker scan completed partially",
            message: dockerResult.error ?? "Some Docker files were not verified.",
            severity: "medium",
            category: "reliability",
            source: dockerScanner.name,
            confidence: "confirmed",
            evidence: (dockerResult.diagnostics ?? []).join(" "),
          }));
        }
      }
    }

    const allFindings = collector.getAll();

    // 5. AI Remediation Advisory for Security Findings
    let aiAdvisory: string | null = null;
    const securityFindings = collector.getByCategory("security");
    if (securityFindings.length > 0 && canUseAi) {
      aiAdvisory = await generateAdvisory(securityFindings, {
        ...context.dependencies,
        ...context.devDependencies,
      });
    }

    const mode = options.mode ?? "build";
    const hasBlockingIssues = collector.hasBlockingIssues(mode === "prod" ? "medium" : "high");
    const hasFailedScanner = scannerCoverage.some((c) => c.status === "failed" || c.status === "unavailable");
    const exitCode = hasFailedScanner ? 3 : (hasBlockingIssues ? 1 : 0);

    return {
      findings: allFindings,
      totalParsedLines,
      engine: activeEngineName,
      mode,
      scannedEnvFiles: context.envFiles,
      aiAdvisory,
      scannerCoverage,
      hasBlockingIssues,
      exitCode,
    };
  }
}
