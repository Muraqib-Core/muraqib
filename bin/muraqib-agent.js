#!/usr/bin/env node
import("../dist/agent-v2/cli.js")
  .then(({ runAgentCli }) => runAgentCli(process.argv.slice(2)))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exitCode = 1;
  });
