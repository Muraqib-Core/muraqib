#!/usr/bin/env node
const args = process.argv.slice(2);

// Git hooks call `muraqib hook ...`; load only the small hook module so they start fast.
// A hook that cannot even load must not block the commit/push, so `hook run` fails open.
async function main() {
  if (args[0] === "hook") {
    try {
      const { runHookCli } = await import("../dist/hooks/cli.js");
      return await runHookCli(args.slice(1));
    } catch (error) {
      console.error(args[1] === "run" ? "muraqib: hook could not run, continuing:" : "Fatal error:", error);
      return args[1] === "run" ? 0 : 1;
    }
  }
  const { runCli } = await import("../dist/cli/index.js");
  return runCli(args);
}

// Use process.exitCode (not process.exit) so large stdout payloads are fully
// flushed when piped; process.exit() truncates output at the 64KB pipe buffer.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exitCode = 1;
  });
