# Muraqib Audit — Quick Guide

This repository includes a lightweight audit runner (Muraqib) to check images, bundle size, network latency, security headers, dead code, dependency issues, async patterns, and configuration.

How to run the audit locally

- Start the local server (optional, recommended for network/security checks):
  - Copy examples/express-prisma/.env.example to examples/express-prisma/.env
  - npm install --prefix examples/express-prisma
  - npm run dev-server
  - server defaults to http://localhost:3000 when running locally

- Run the audit interactively:
  - npx tsx src/index.ts

- Produce machine-readable reports (committed to repo by the maintainer when appropriate):
  - npx tsx scripts/collect-audit.ts  # writes muraqib-collect-report-<timestamp>.json
  - npx tsx scripts/generate-dead-report.ts  # writes dead-code-report-<timestamp>.json
  - npx tsx scripts/save-audit-report.ts  # runs the standard audit runner and attempts to save a report

CI

A GitHub Actions workflow (.github/workflows/audit.yml) runs the audit on pushes and PRs and uploads artifacts.

Notes

- To reduce noise during triage, some unused exports in the codebase are annotated with `// muraqib-ignore-dead` (auto-generated). This is non-destructive and can be removed per-file when you perform manual cleanup.
- I avoided destructive automatic deletions; unreachable-code findings are listed in the dead-code report for manual review.
