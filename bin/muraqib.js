#!/usr/bin/env node
import { runCli } from "../dist/cli/index.js";

runCli(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
