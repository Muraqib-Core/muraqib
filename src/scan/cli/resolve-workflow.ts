import * as x from "@clack/prompts";
import { styleText } from "node:util";
import type { ProjectContext } from "../core/context/project-context.js";
import { DependencyGraph } from "../core/resolution/dependency-graph.js";
import { ResolutionEngine } from "../core/resolution/resolution-engine.js";
import { ResolutionApplier } from "../core/resolution/resolution-applier.js";
import type { ApprovalDecision, ResolutionPlan, ResolutionResult } from "../core/resolution/resolution-plan.js";
import { AuditRunner, type AuditReport } from "../core/runner/audit-runner.js";

const RULE = "────────────────────────────────────────────";

/** Scans the project; a failed scan ends the process. */
async function scanProject(context: ProjectContext, spinner: { stop: (message: string) => void }): Promise<AuditReport> {
  try {
    return await new AuditRunner().run(context, { enableAi: false });
  } catch (err: unknown) {
    spinner.stop("Failed to scan project dependencies.");
    return failScan(err);
  }
}

function failScan(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(styleText("red", `\nScan error: ${msg}\n`));
  return process.exit(1);
}

/** Plans are alternatives: with several, the user picks one to inspect. Returns undefined when cancelled or gone. */
async function choosePlan(plans: ResolutionPlan[]): Promise<ResolutionPlan | undefined> {
  // Applying one plan invalidates every plan generated from the old state.
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
      return undefined;
    }
    selectedPlanId = String(selection);
  }

  const plan = plans.find((candidate) => candidate.id === selectedPlanId);
  if (!plan) x.cancel("The selected resolution candidate is no longer available.");
  return plan;
}

function printPlan(plan: ResolutionPlan): void {
  const primaryChange = plan.changes[0];
  const problem = plan.findingsResolved[0]?.dependencyProblem;
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
}

/** Strict approval prompt (default: No). */
async function confirmApply(): Promise<boolean> {
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
    return false;
  }
  return true;
}

function printVerification(result: ResolutionResult): void {
  console.log("Verifying...");
  for (const step of result.verificationResults ?? []) {
    const icon = step.passed ? styleText("green", "✓") : styleText("red", "✗");
    const title = step.step.charAt(0).toUpperCase() + step.step.slice(1);
    console.log(`${icon} ${title}: ${step.status ?? "unknown"}${step.message ? ` — ${step.message}` : ""}`);
  }
}

/** Applies an approved plan, reporting each stage; failure and stale states end the flow early. */
async function applyApprovedPlan(plan: ResolutionPlan, graph: DependencyGraph): Promise<void> {
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

  printVerification(result);

  if (result.status === "applied") {
    console.log(styleText(["bold", "green"], "\nResolution completed successfully.\n"));
  } else {
    console.log(styleText(["bold", "yellow"], `\n${result.message}\n`));
  }
  console.log(styleText("dim", RULE));
}

/**
 * Run resolve workflow.
 *
 * @param context - Context
 */
export async function runResolveWorkflow(context: ProjectContext): Promise<void> {
  console.log(styleText("dim", RULE));
  console.log(styleText(["bold", "cyan"], "Muraqib Dependency Resolution 🛡️"));
  console.log(styleText("dim", `${RULE}\n`));

  const spinner = x.spinner();
  spinner.start("Analyzing dependency graph & security advisories...");

  // 1. Run audit runner to collect findings
  const report = await scanProject(context, spinner);
  spinner.stop("Dependency analysis complete.\n");

  // 2. Build dependency graph and resolution engine
  const graph = new DependencyGraph(context.projectPath);
  const plans = new ResolutionEngine(graph).generatePlans(report.findings);

  if (plans.length === 0) {
    x.note(
      "No resolvable dependency problems detected in the current project.",
      "Clean Dependencies ✨"
    );
    process.exit(0);
  }

  const plan = await choosePlan(plans);
  if (!plan) return;

  printPlan(plan);
  if (!(await confirmApply())) return;
  await applyApprovedPlan(plan, graph);
}
