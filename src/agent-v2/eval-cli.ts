import { formatEvaluationJson, formatEvaluationText } from "./eval/format.js";
import { runEvaluation } from "./eval/run.js";

/** Usage text of `muraqib-agent eval`. */
export const EVAL_USAGE = `Usage: muraqib-agent eval [--json]

Runs the fixers on three built-in projects with known problems (created in a temp folder,
removed afterwards) and prints how many fixes were correct. Uses no network and no API key;
Gemini explanations are not part of this measurement.

Exit codes: 0 no wrong fix, 1 at least one wrong fix, 2 usage error.
`;

/** `muraqib-agent eval`: returns the process exit code. A wrong fix (a fix that fails its ground truth) is a failure. */
export async function runEvalCli(args: readonly string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(EVAL_USAGE);
    return 0;
  }
  const unknown = args.find((a) => a !== "--json");
  if (unknown !== undefined) {
    process.stderr.write(`Unknown argument: ${unknown}\n${EVAL_USAGE}`);
    return 2;
  }
  const result = await runEvaluation();
  process.stdout.write(args.includes("--json") ? formatEvaluationJson(result) : formatEvaluationText(result));
  return result.total.metrics.wronglyFixed > 0 ? 1 : 0;
}
