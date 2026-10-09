import { loadEnv } from "../env.js";
import { getArg } from "../shared/utils.js";
import { CLI_FLAGS } from "../shared/constants.js";
import { runAuditWorkflow } from "./workflow.js";
import { type AuditOptions } from "../orchestrator/audit.js";

export function parseCliArgs(args: string[]) {
  return {
    skipEnv: args.includes(CLI_FLAGS.SKIP_ENV),
    skipNetwork: args.includes(CLI_FLAGS.SKIP_NETWORK),
    skipMemory: args.includes(CLI_FLAGS.SKIP_MEMORY),
    skipSecurity: args.includes(CLI_FLAGS.SKIP_SECURITY),
    skipDeadCode: args.includes(CLI_FLAGS.SKIP_DEAD_CODE),
    skipDependencies: args.includes(CLI_FLAGS.SKIP_DEPENDENCIES),
    skipAsync: args.includes(CLI_FLAGS.SKIP_ASYNC),
    skipConfig: args.includes(CLI_FLAGS.SKIP_CONFIG),
    skipPerformance: args.includes(CLI_FLAGS.SKIP_PERFORMANCE),
    skipOptimizer: args.includes(CLI_FLAGS.SKIP_OPTIMIZER),
    skipRenderBlocking: args.includes(CLI_FLAGS.SKIP_RENDER_BLOCKING),
    silent: args.includes(CLI_FLAGS.SILENT),
    safe: args.includes(CLI_FLAGS.SAFE),
    upgrade: args.includes(CLI_FLAGS.UPGRADE),
    targetPath: getArg(args, CLI_FLAGS.PATH),
    latencyUrl: getArg(args, CLI_FLAGS.URL),
    securityUrl: getArg(args, CLI_FLAGS.SECURITY_URL),
    schedule: getArg(args, CLI_FLAGS.SCHEDULE),
    presets: getArg(args, CLI_FLAGS.PRESETS)?.split(","),
  };
}

export async function run() {
  loadEnv({ verbose: false });
  const args = process.argv.slice(2);
  const opts: AuditOptions = {
    ...parseCliArgs(args),
    exitProcess: true,
  };
  return runAuditWorkflow(opts);
}
