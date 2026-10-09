import { styleText } from "node:util";
import type { Finding } from "../../core/findings/finding.js";

export function renderFindings(findings: Finding[]): void {
  if (findings.length === 0) return;

  const syntaxAndValidation = findings.filter(
    (f) => f.category === "validation" || f.category === "configuration"
  );
  const dependencyProblems = findings.filter((f) => f.dependencyProblem !== undefined);
  const otherSecurityFindings = findings.filter(
    (f) => f.category === "security" && f.dependencyProblem === undefined
  );
  const compatFindings = findings.filter((f) => f.category === "compatibility");
  const reliabilityFindings = findings.filter((f) => f.category === "reliability");

  if (syntaxAndValidation.length > 0) {
    console.log(`\n  ${styleText(["cyan", "bold"], "── Configuration & Validation Issues 📋 ──────────────")}`);
    syntaxAndValidation.forEach((f) => {
      const isErr = f.severity === "high" || f.severity === "critical";
      const badgeColor = isErr ? ["bgRed", "white"] : ["bgYellow", "black"];
      const badgeText = isErr ? " ERROR " : " WARN  ";
      const location = f.file
        ? `${styleText("cyan", f.file)}${f.line ? `:${styleText("dim", String(f.line))}` : ""}`
        : "ENV";
      console.log(
        `    ${styleText(badgeColor as Parameters<typeof styleText>[0], badgeText)} [${location}] ${f.message}`
      );
    });
  }

  if (dependencyProblems.length > 0) {
    console.log(`\n  ${styleText(["red", "bold"], "── Dependency Problems 📦 ──────────────────────────────")}`);
    dependencyProblems.forEach((f) => {
      const p = f.dependencyProblem!;
      console.log(
        `    ${styleText(["bgRed", "white"], " VULN  ")} [${f.file ?? "package.json"}] ${styleText("bold", p.package)}@${styleText("yellow", p.installedVersion)}`
      );
      console.log(
        `           ${styleText("red", `${p.advisoryCount} known ${p.advisoryCount === 1 ? "vulnerability" : "vulnerabilities"}`)}`
      );
    });
  }

  if (otherSecurityFindings.length > 0) {
    console.log(`\n  ${styleText(["red", "bold"], "── Security Vulnerabilities 🚨 ─────────────────────────")}`);
    otherSecurityFindings.forEach((f) => {
      const isCritical = f.severity === "critical";
      const badgeColor = isCritical ? ["bgMagenta", "white"] : ["bgRed", "white"];
      const badgeText = isCritical ? " CRIT  " : " VULN  ";
      const location = f.file ?? "deps";
      console.log(
        `    ${styleText(badgeColor as Parameters<typeof styleText>[0], badgeText)} [${location}] ${f.message}`
      );
      if (f.remediation) {
        console.log(`           ${styleText("green", "Remediation:")} ${f.remediation}`);
      }
    });
  }

  if (compatFindings.length > 0) {
    console.log(`\n  ${styleText(["yellow", "bold"], "── Compatibility & Environment Conflicts 🔄 ────────────")}`);
    compatFindings.forEach((f) => {
      const badge = `${styleText(["bgYellow", "black"], " COMPAT ")}`;
      console.log(`    ${badge} [${f.file ?? "env"}] ${f.message}`);
      if (f.remediation) {
        console.log(`           ${styleText("green", "Remediation:")} ${f.remediation}`);
      }
    });
  }

  if (reliabilityFindings.length > 0) {
    console.log(`\n  ${styleText(["blue", "bold"], "── Scanner Diagnostics & Reliability ℹ️ ────────────────")}`);
    reliabilityFindings.forEach((f) => {
      const badge = `${styleText(["bgBlue", "white"], " INFO   ")}`;
      console.log(`    ${badge} ${f.message}`);
    });
  }

  console.log("");
}
