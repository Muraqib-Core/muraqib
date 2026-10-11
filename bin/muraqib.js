#!/usr/bin/env node
import { runCli } from "../dist/cli/index.js";

// Use process.exitCode (not process.exit) so large stdout payloads are fully
// flushed when piped; process.exit() truncates output at the 64KB pipe buffer.
runCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exitCode = 1;
  });
