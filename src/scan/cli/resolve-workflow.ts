import * as x from "@clack/prompts";
import { styleText } from "node:util";
import type { ProjectContext } from "../core/context/project-context.js";
import { DependencyGraph } from "../core/resolution/dependency-graph.js";
import { ResolutionEngine } from "../core/resolution/resolution-engine.js";
import { ResolutionApplier } from "../core/resolution/resolution-applier.js";
import type { ApprovalDecision } from "../core/resolution/resolution-plan.js";
import { AuditRunner } from "../core/runner/audit-runner.js";

export async function runResolveWorkflow(context: ProjectContext): Promise<void> {
  console.log(styleText("dim", "────────────────────────────────────────────"));
  console.log(styleText(["bold", "cyan"], "Muraqib Dependency Resolution 🛡️"));
  console.log(styleText("dim", "────────────────────────────────────────────\n"));

  const spinner = x.spinner();
  spinner.start("Analyzing dependency graph & security advisories...");

  // 1. Run audit runner to collect findings
  const runner = new AuditRunner();
  let report;
  try {
    report = await runner.run(context, { enableAi: false });
  } catch (err: unknown) {
    spinner.stop("Failed to scan project dependencies.");
    const msg = err instanceof Error ? err.message : String(err);
    console.log(styleText("red", `\nScan error: ${msg}\n`));
    process.exit(1);
  }

  spinner.stop("Dependency analysis complete.\n");

  // 2. Build dependency graph and resolution engine
  const graph = new DependencyGraph(context.projectPath);
  const engine = new ResolutionEngine(graph);

  const plans = engine.generatePlans(report.findings);

  if (plans.length === 0) {
    x.note(
      "No resolvable dependency problems detected in the current project.",
      "Clean Dependencies ✨"
    );
    process.exit(0);
  }

  // Plans are alternatives. Applying one invalidates every plan generated from the old state.
  let selectedPlanId = plans[0]?.id;
  if (plans.length > 1) {
    const selection = await x.select({
      message: "Select one resolution candidate to inspect:",
      options: plans.map((plan) => ({
        value: plan.id,
        label: plan.planName,
        hint: `${plan.changes.length} package change(s), compatibility: ${plan.compatibility}`,
      })),
    });
    if (x.isCancel(selection)) {
      x.cancel("Resolution cancelled. No changes were applied.");
      return;
    }
    selectedPlanId = String(selection);
  }

  const plan = plans.find((candidate) => candidate.id === selectedPlanId);
  if (!plan) {
    x.cancel("The selected resolution candidate is no longer available.");
    return;
  }

  const primaryChange = plan.changes[0];
  const finding = plan.findingsResolved[0];
  const problem = finding?.dependencyProblem;
  const advisoryCount = problem?.advisoryCount ?? 1;

  console.log(
    `⚠  ${styleText(["bold", "yellow"], `${primaryChange?.packageName}@${primaryChange?.currentVersion}`)}`
  );
  console.log(
    `${styleText("red", `${advisoryCount} known security ${advisoryCount === 1 ? "advisory" : "advisories"}.`)}\n`
  );

  console.log(styleText(["bold", "cyan"], "Resolution Candidate:"));
  console.log(styleText("bold", plan.planName));
  console.log("");

  for (const c of plan.changes) {
    console.log(styleText("bold", c.packageName));
    console.log(`${styleText("red", c.currentVersion)} → ${styleText("green", c.targetVersion)}`);
    if (c.reason) {
      console.log(styleText("dim", `Reason: ${c.reason}`));
    }
    console.log("");
  }

  console.log("Security expectation:");
  console.log(`• ${plan.securityImpact}\n`);

  console.log("Compatibility evidence:");
  const compatibilityIcon = plan.compatibility === "Incompatible" ? "✗" : "•";
  console.log(`${compatibilityIcon} ${plan.compatibility}\n`);

  if (plan.limitations?.length) {
    console.log("Limitations:");
    for (const limitation of plan.limitations) console.log(`• ${limitation}`);
    console.log("");
  }

  console.log("Packages affected:");
  console.log(`${plan.affectedPackages.length}\n`);

  console.log("Risk:");
  console.log(`${plan.risk}\n`);

  // 4. STRICT APPROVAL PROMPT (DEFAULT: NO)
  const approval = await x.select({
    message: "Apply this resolution?",
    options: [
      { value: "yes", label: "Yes", hint: "Apply the approved dependency changes" },
      { value: "no", label: "No", hint: "Do not modify any project files" },
    ],
    initialValue: "no",
  });

  if (x.isCancel(approval) || approval !== "yes") {
    console.log("\n" + styleText("yellow", "Resolution cancelled."));
    console.log(styleText("dim", "No changes were applied.\n"));
    return;
  }

    // Explicit approval decision
  const decision: ApprovalDecision = "approved";
  const applier = new ResolutionApplier(graph);

  console.log("\nRe-checking project state and applying only if it still matches...");

  console.log("\nApplying approved resolution...");
  for (const c of plan.changes) {
    console.log(styleText("green", `✓ ${c.packageName} ${c.currentVersion} → ${c.targetVersion}`));
  }

  console.log("\nUpdating lockfile...");
  const applySpinner = x.spinner();
  applySpinner.start(`Running ${graph.packageManager} to update lockfile and node_modules...`);

  const result = await applier.apply(plan, decision);
  applySpinner.stop("Complete\n");

  if (result.status === "stale") {
    console.log(styleText("red", `✗ ${result.message}`));
    return;
  }

  if (!result.applied) {
    console.log(styleText("red", `✗ Failed to apply resolution: ${result.message}`));
    return;
  }

  console.log("Verifying...");
  if (result.verificationResults) {
    for (const step of result.verificationResults) {
      const icon = step.passed ? styleText("green", "✓") : styleText("red", "✗");
      const title = step.step.charAt(0).toUpperCase() + step.step.slice(1);
      console.log(`${icon} ${title}: ${step.status ?? "unknown"}${step.message ? ` — ${step.message}` : ""}`);
    }
  }

  if (result.status === "applied") {
    console.log(styleText(["bold", "green"], "\nResolution completed successfully.\n"));
  } else {
    console.log(styleText(["bold", "yellow"], `\n${result.message}\n`));
  }
  console.log(styleText("dim", "────────────────────────────────────────────"));
}
