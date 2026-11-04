---
title: CLI usage
type: reference
created: 2026-11-04
updated: 2026-11-04
sources:
  - code: src/cli/args.ts
verified_at: f39b88d
---

# CLI usage

> Part of the [Muraqib documentation](../README.md). AI agent commands are in [ai.md](ai.md) and [agent-v2.md](agent-v2.md); CI setup is in [ci.md](ci.md).

## 📟 CLI Usage
After `npm run build`, the `muraqib` binary (`bin/muraqib.js`) exposes five commands.

| Command | Purpose |
|---------|---------|
| `muraqib audit` (default) | Run the guard modules, optionally adding the scan layer (OSV, Docker, AI advisory) |
| `muraqib resolve` | Interactive, evidence-based dependency resolution with an approval step and rollback |
| `muraqib image --image <name>` | Scan an existing local Docker image with [Trivy](https://trivy.dev) (must be installed) |
| `muraqib runtime --container <name>` | Read-only inspection of a running Docker container |
| `muraqib hook install` / `uninstall` | Git hooks: block commits that stage secrets; opt-in security audit before push |

### `audit` options

```bash
muraqib audit                              # text report of every module
muraqib audit --format json                # json | text | html | csv | md
muraqib audit --format html -o report.html # write the report to a file
muraqib audit -p ./my-app                  # audit another project root
muraqib audit -m memory-guard,security-guard  # only matching modules
muraqib audit --fail-on-warning            # exit 1 on warnings too
muraqib audit --report -o "$GITHUB_STEP_SUMMARY"  # Markdown security scorecard
```

| Flag | Effect |
|------|--------|
| `--osv` | Add the scan layer: check dependencies against [OSV](https://osv.dev) for known vulnerabilities |
| `--docker` | Add the scan layer: Docker configuration discovery (Dockerfile / Compose) |
| `--ai-advisory` | Add the scan layer plus an optional AI advisory (needs `GEMINI_API_KEY`; secrets are redacted before anything is sent) |
| `-p, --project <path>` | Project root (default: current directory) |
| `-f, --format <fmt>` | `text`, `json`, `html`, `csv` or `md` (`markdown` is accepted as an alias) |
| `--report` | Shorthand for `--format md`: the security scorecard and compliance report |
| `-o, --output <path>` | Write the report to a file instead of stdout |
| `-m, --modules <list>` | Comma-separated module name filter |
| `--fail-on-warning` | Treat warnings as failures |
| `-i`, `--interactive` | Guided mode: choose what to audit, review colour-coded results, then fixes / AI hand-off / HTML report (terminal only) |
| `--no-interactive` | Disable the spinner and prompts in a terminal |
| `-v, --verbose` | Verbose logging |

#### Security scorecard (`--report` / `--format md`)

The Markdown report opens with a README-ready badge and an overall **0–100 score**, then breaks it down by severity (Critical, High, Medium, Low) and by domain (Security, Dependencies, Code Quality). Paste it into a README or write it to `$GITHUB_STEP_SUMMARY` in CI. The score is a pure function of the findings, so the same report always yields the same score:

- Starting from 100, each finding subtracts 25 (critical), 10 (high), 4 (medium) or 1 (low); the score never goes below 0. Informational findings are listed but not scored.
- **Hard cap:** any critical finding limits the overall score to **59** (grade F), however little else is wrong.
- Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F below 60.
- Guard `error` findings count as high and `warning` as medium; the scan layer's own five-level severity is used as reported. Findings from `security-guard`, scan findings in the `security` category count as Security; package, image and compatibility findings count as Dependencies; everything else counts as Code Quality.
- The report lists which modules were evaluated: modules that were not run do not affect the score, so run the full audit for a meaningful number. The score does not change the exit code.

The same logic is available programmatically as `calculateScorecard()` and `formatMarkdown()`.

Any of `--osv`, `--docker` or `--ai-advisory` switches on the scan layer; its findings are merged into the same report. The unified report includes `exitCode` and `modules.scan.scan`, which retains the scan policy, blocking decision and per-scanner coverage (`status`, scanned/skipped inputs and diagnostics). Text, HTML, CSV and interactive reports display these coverage details too. `-e prod` blocks medium scan findings even though their displayed severity stays `warning`; `build` blocks high and critical findings. A scanner failure takes precedence and returns exit code `3`. Agent module summaries also retain scan metadata; scanner failures set `ok: false`, `verdict: "fail"` and `exitCode: 3`. The OSV endpoint and timeout can be overridden with `OSV_API_URL` and `OSV_TIMEOUT` (ms).

### `hook`: catch secrets before they are committed

```bash
muraqib hook install              # pre-commit: scan the staged changes for secrets
muraqib hook install --pre-push   # also run the security audit before every push (opt-in)
muraqib hook uninstall            # remove Muraqib's blocks (--pre-push: only the pre-push one)
```

- **Only staged content is scanned.** The pre-commit hook reads `git diff --cached` and inspects just the lines the commit adds, so the working tree and secrets committed long ago never get in the way. It runs in well under a second and exits `1` (blocking the commit) only for credentials that are almost certainly real: live Stripe/GitHub/AWS/Slack/`sk-` tokens, private keys, real values in a staged `.env`, and so on. Weaker or public-by-design matches (publishable keys, JWTs, `password = "..."`) are printed as warnings and never block. Secrets are masked in the output.
- **False positive?** Add `muraqib-ignore-secret` to the line, bypass once with `git commit --no-verify`, or set `MURAQIB_SKIP_HOOKS=1`.
- **Pre-push** (opt-in) runs the security audit: leaked or tracked secrets in env files (config-guard) plus the scan layer (OSV vulnerabilities, Docker, env validation). Critical/error security findings block the push; other config hygiene and warnings are only counted. If a scanner cannot finish (for example offline) and nothing else blocks, it warns and lets the push through.
- **Your existing hooks are safe.** Install never replaces a hook file: it adds one block between `# >>> muraqib <hook> >>>` and `# <<< muraqib <hook> <<<` markers (after the shebang, so a trailing `exec` cannot skip it), and uninstall removes exactly that block, restoring the file byte for byte. `core.hooksPath` is honoured, and with Husky the block goes into the editable `.husky/<hook>` file rather than the generated `.husky/_` stubs. A hook written in a non-shell language is left alone with a message.
- **A broken hook never traps you.** Only findings block. A missing Muraqib binary, an unreadable index or a crash prints a warning and lets the git operation continue.

### `resolve`

```bash
muraqib resolve            # run inside the project you want to resolve
muraqib -p ./my-app resolve
```

Builds a resolution plan from OSV evidence, shows it for approval, applies it, verifies the result and rolls back on failure. Put `-p` **before** `resolve`; `resolve` itself takes no other flags.

### `image` and `runtime`

```bash
muraqib image --image my-app:latest [--json]
muraqib runtime --container my-app [--json]
```

`image` requires the `trivy` binary and only scans images that already exist locally. `runtime` inspects the container read-only; it never starts, stops or modifies it.

### 🤖 AI agents and Agent v2

The `muraqib agent`, `context` and `tool-schema` commands are documented in [ai.md](ai.md). The separate `muraqib-agent` command (ranked plan, verified fixes, optional Gemini) is documented in [agent-v2.md](agent-v2.md).

### Interactive mode

In a terminal, `muraqib audit` shows a Clack spinner and a pass/fail summary. Add `-i` for the guided flow:

1. **What to audit**: pick categories (Full, Security, Performance & images, Configuration, Code health). Skipped when you pass `-m`.
2. **Security URL**: asked only when the security module is included; leave it empty to skip.
3. **Optional scans**: OSV, Docker, AI advisory (skipped when you pass `--osv`/`--docker`/`--ai-advisory`).
4. **Results**: a colour-coded overview, per-module issues with file, line and fix, and prioritised next steps.
5. **Follow-ups** (repeated until you pick *Finish*): recommended fixes (de-duplicated, most severe first), every issue, a paste-ready prompt for an AI assistant (ends with the `muraqib agent` re-check command), or save an HTML report.

The exit code is the same as in non-interactive runs (`1` on critical/error, `130` if you cancel). If `-i` is used where no terminal is available it prints a one-line note and runs normally. Interactive output is turned off automatically for `--json`/`--format`, `--output`, piped output and CI (`CI=true`), so machine-readable output is never polluted. Use `--no-interactive` to force it off.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | No blocking findings |
| `1` | Blocking findings (critical/error; warnings too with `--fail-on-warning`) |
| `3` | A scanner failed, so the result is not reliable |
| `130` | Interactive prompt cancelled by the user |
