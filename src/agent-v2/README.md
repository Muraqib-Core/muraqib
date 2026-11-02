# Muraqib agent v2

`muraqib-agent` turns the Muraqib audit into an ordered plan and, for three kinds of problems, into verified fixes. It is a separate command: v1 (`muraqib`) and `src/index.ts` are unchanged.

## What it does

| Command | What you get |
|---|---|
| `muraqib-agent plan` | A ranked list of what to fix first. Works offline, no LLM. `--json` for machines. |
| `muraqib-agent plan --explain [--lang ar\|en]` | The same plan plus a short explanation per step. Gemini if a key is set, built-in text otherwise. |
| `muraqib-agent fix` (same as `--dry-run`) | A patch file with fixes that were verified by re-running the audit. The project is not touched. |
| `muraqib-agent fix --apply` | Applies fixes on a new branch `agent/fix-<time>`, asking before each one. Nothing is committed. |
| `muraqib-agent pr-description` | A PR description (problem, solution, testing) written from the real verification result. |
| `muraqib-agent eval` | Runs the fixers on three built-in projects with known problems and prints how many fixes were correct. |

## The three fixes

1. **Floating promise** (missing `await`): adds `await` inside an `async` function. Outside one it does not guess; it asks you to choose `--choose <issueId>=async` (make the function async) or `=catch` (append `.catch(...)`).
2. **Hardcoded secret**: replaces the literal with `process.env.NAME`, adds an empty `NAME=` to `.env.example`, and warns that the secret must be rotated (and whether it is in git history).
3. **`.env.example`**: creates or completes it from the variables the code actually reads, with no values. An existing file is preserved.

## How a fix is accepted

Each fix is applied to a temporary copy of the project and the audit is run again. It is kept only if the issue it targets disappears **and** no new issue appears. A fix that fails this is reported as rejected and never applied.

## Modes and safety

- `plan`: read-only.
- `fix` / `--dry-run` (default): works on a temp copy and writes `muraqib-agent.patch` (`--out` to change). Check it with `git apply --check`, apply it with `git apply`.
- `fix --apply`: needs a git repository, a clean working tree and an interactive terminal. It creates a new branch and asks `[y/N]` for every fix. Before each question it prints a diff preview of the change on stderr (one line of context, at most 40 lines per file, new files marked). The preview never shows a secret: for fixes that remove one the removed lines are hidden, and any other line that looks like a secret is redacted or hidden.
- **Secrets are never written anywhere.** Fixes that remove a secret are verified but left out of the patch file, because a diff would contain the removed value; they are applied only with `--apply`. Reports, warnings and descriptions mention the location and type only.
- The `process.env.NAME` replacement is typed `string | undefined`; adjust types if your code expects `string`.

## Stronger check: `--verify-cmd`

The audit alone does not prove the project still builds or that its tests pass (for example `process.env.NAME` is `string | undefined`). Optionally add your own commands:

```
muraqib-agent fix --verify-cmd "npm run type-check" --verify-cmd "npm test" --verify-timeout 300
```

- Commands run in order, in a temp copy of the project with the fix applied, never in the real project. The copy has no `node_modules`, so the real project's `node_modules` is linked into it (a junction on Windows); if linking fails the outcome says so.
- Each command first runs once on the unmodified copy (cached for the whole session). If it already fails there, the fix outcome shows `verify-cmd baseline already failing - not used` and the command is ignored. If it passes before and fails after the fix, the fix is rejected with `verify command failed: <command> (exit N)` plus the last ~20 lines of output, redacted (a line that still looks like a secret is shown as `(line hidden)`).
- `--verify-timeout <seconds>` (default 120) applies per run; on timeout the whole process tree is killed and the run counts as a failure.
- **Security:** the commands are written by you and run through the platform shell (`shell: true`). They inherit your environment except `GEMINI_API_KEY` and `GOOGLE_API_KEY`, which are removed. The environment is never logged.
- The report and `pr-description` list the commands that passed. Without `--verify-cmd` nothing changes.

Limits: a command judges the project as a whole, not the single fix; a baseline that already fails cannot be used; every command runs once per proposed fix, so slow commands multiply by the number of fixes. Commands that modify files only change the copy (but writes into the linked `node_modules`, such as caches, reach the real one), and interactive or watch-mode commands never finish and end in the timeout.

## Gemini (optional)

### Setup (step by step)

1. **Get a free key:** open <https://aistudio.google.com/apikey>, sign in with a Google account, choose **Create API key**, copy it.
2. **Install the optional package** where you run Muraqib: `npm i @google/genai`.
3. **Set the key as an environment variable** (never in a file or in the repository):
   - macOS / Linux, current terminal only: `printf "Gemini key: "; read -rs GEMINI_API_KEY; echo; export GEMINI_API_KEY`
   - Windows PowerShell: `$env:GEMINI_API_KEY = "<your key>"`
   - To keep it across sessions, set it in your OS or shell profile. `GOOGLE_API_KEY` also works. `.env` files are not read.
4. **Run:** `muraqib-agent plan --explain --lang ar` (from a clone: `node bin/muraqib-agent.js plan --explain` after `npm run build`).
5. **Check the result:** the last lines should say `Explanations: llm (gemini-flash-lite-latest, 1 request(s), ...)`. Run it again and it says `cached` with 0 requests. `fallback` means the built-in text was used, and the `Note:` line says why (no key, package missing, rate limit, request error, or a possible secret found in the prompt).

On the free tier Google may use submitted content to improve its products (check its current terms). Muraqib sends only redacted issue metadata, never file contents.

### How it behaves

- Off by default. It runs only with `plan --explain`, and only if `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set in the environment. The key is never read from or written to a file.
- Needs the optional package `@google/genai`. Without it, or without a key, `--explain` falls back to built-in explanations and says so.
- Model: the alias `gemini-flash-lite-latest`, set in one place (`explain/config.ts`). Google retires named models, and a retired one answers HTTP 404 even while it is still listed, so the default is an alias. To use another model without editing code, set `MURAQIB_AGENT_MODEL` (for example `gemini-3.5-flash`).
- What is sent: for the top N steps (default 10, `--explain-top`), the issue code, severity, file, line and a redacted description, in **one** batched request. File contents are never sent. Credentials, `KEY=value` assignments, URL credentials and bearer tokens are replaced with `[REDACTED]`, and if anything that looks like a secret is still in the prompt, nothing is sent.
- Limits: at most 3 requests per run; up to 2 retries after HTTP 429 or 503 (waits 1 s then 2 s); then it falls back to the built-in text. Results are cached on disk in `~/.cache/muraqib-agent` (override with `MURAQIB_AGENT_CACHE_DIR`), keyed by model, language and issue id, so the same issue is not sent twice.
- Gemini only writes explanations. It never edits code and never decides whether a fix is accepted: fixes are identical with or without a key.
- Free-tier quotas belong to Google and change; check them in Google AI Studio.
- Status: checked once by hand with a real free key (Windows, `llm` mode, 1 request for 3 steps). Not measured: explanation quality over many issues, and the retry after a 503 against the real service. See `EVALUATION.md`.

### If it says `fallback`

The line starting with `Note:` gives the reason. It never contains your key.

| Note | Meaning | What to do |
|---|---|---|
| `No GEMINI_API_KEY set` | no key in the environment | set it in this terminal (see Setup) |
| `@google/genai is not installed` | optional package missing | `npm i @google/genai` |
| `HTTP 404: model not found or no longer available` | the model was retired (it can still appear in Google's model list) | set `MURAQIB_AGENT_MODEL` to a model that works for your key |
| `HTTP 400/401/403` | key rejected, restricted, or the API is not enabled for its project | create a new key in Google AI Studio |
| `unavailable (503)` or `rate limit (429) persisted after retries` | Google is busy or the quota is used up | wait and run again |
| `network error ...` | no connection, or a proxy is in the way | check your connection or proxy |
| `A possible secret was found in the prompt` | the safety check blocked the request | nothing was sent; look at the issue text |

To see which models your key can use without printing the key (PowerShell):
`(Invoke-RestMethod -Uri "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100" -Headers @{ "x-goog-api-key" = $env:GEMINI_API_KEY }).models | ForEach-Object { $_.name }`.
A model can be listed and still answer 404, so try one with a tiny request before relying on it.

## Known limits

What the detectors see was measured on small test files (2 November 2026), not guessed. `muraqib-agent` only fixes what the audit reports, so a miss here means no fix is proposed.

| Case | Seen? |
|---|---|
| `fetch("/x");`, `axios.get("/x");` or `request(...)` as a statement in a `.ts` file | yes |
| the same call split over several lines | yes (reported on the first line) |
| a call to an `async` function declared in the same file, with no arguments (`save();`) | yes |
| the same call **with** arguments (`save(1);`) | **no** |
| a call to an `async` function imported from another file | **no** |
| `const p = fetch(...)` that is never awaited | **no** |
| `db.query(...);` or any call on an object | **no** |
| `Promise.all([...]);` as a statement | **no** |
| the same code in a `.js` file | **no** (v1 scans `.ts` for this check) |
| `process.env.NAME`, `process.env["NAME"]`, `import.meta.env.NAME` missing from `.env.example` | yes |
| `const { NAME } = process.env` | **no** |
| `process.env[someVariable]` | **no** |
| a secret in a known format (Stripe, GitHub, AWS, Slack, `sk-`, JWT, PEM) or `password = "..."` | yes |
| a long random token with no known prefix | **no** |
| a secret built from two strings (`"sk_live" + "..."`) | **no** |

These limits come from v1's line-based heuristics and pattern lists. v1 is not changed by agent-v2, so they stay until v1 improves.

- Line endings: files with `CRLF`, mixed endings, a BOM or no final newline are edited without changing any other line ending (covered by `tests/unit/agent-v2/fix/crlf.spec.ts`). A **new** `.env.example` is always created with `LF`; an existing one keeps its own endings.

### Speed

`plan` is fast; `fix` is slow on big projects because every accepted fix is verified by auditing a temporary copy. Measured on a Linux sandbox with synthetic TypeScript projects of about 60 lines per file (wall time, one run each, so treat it as an order of magnitude):

| Files | `plan` | `fix --dry-run`, 5 fixes | `fix --dry-run`, 30 fixes | Peak memory |
|---|---|---|---|---|
| 100 | 0.3 s | 2.3 s | 5.8 s (only 13 fixes existed) | 183 MB |
| 400 | 0.6 s | 11 s | 62 s | 227 MB |
| 1500 | 3.4 s | 73 s | 413 s | 267 MB |

Almost all of the time is audits: each accepted fix runs about 3 audits and one copy of the project (`node_modules`, `.git`, `dist` and `coverage` are not copied). Use `--max-fixes` to bound a run on a large project. Reusing the audit results between rounds would cut this by a third or more; that is not done yet.

- The fixers are conservative: when a line is ambiguous (two literals, a template with `${}`, a multi-line key) they skip it.
- Fixes are checked by the Muraqib audit, not by your tests or a type-check. Run your own checks before merging.
- agent-v2 reads v1 code (the audit, the secret detector, the file scanner, the Gemini helpers) but never changes it. `tests/unit/agent-v2/v1-contract.spec.ts` fails with a clear message if v1 changes one of those surfaces.

## Layout

```
src/agent-v2/
  planner.ts            rank issues with fixed rules
  detectors/            secrets and env detectors (read-only, reuse v1 helpers)
  explain/              optional Gemini explainer, redaction, cache, built-in text
  fix/                  verification loop, session (propose/apply), patch, fixers/
  eval/                 evaluation projects and metrics
  pr-description.ts     PR text from the verification result
  cli.ts, fix-cli.ts, pr-description-cli.ts
```

## Ignoring things

`plan`, `fix`, `pr-description` and `eval` can be told to leave code alone.

**Inline markers** (same convention as the v1 commit hook):

- A line containing `muraqib-ignore-secret` is skipped by the secrets detector.
- A line containing `muraqib-ignore-env` is skipped by the env-usage detector. A variable whose every usage is on such lines is not reported; if it is also used on other lines it is still reported, at its first unmarked usage.

**`.muraqibignore`** at the project root uses gitignore syntax (`#` comments, blank lines, `dir/`, `**` globs, `!negation`; CRLF line endings and a UTF-8 BOM are accepted). Paths are matched relative to the project root with `/` separators, so it behaves the same on Windows. Example for this repository:

```
# detector patterns and examples, not real secrets
src/core/secret-detector.ts
src/core/secret-guard.ts
# env reads inside evaluation fixtures
src/agent-v2/eval/projects.ts
```

Every plan issue whose file matches is dropped, so no fixer ever receives a step for it and verification (which re-audits temp copies) sees the same list. v1 audit modules such as `async-guard` still run on those files; their issues are filtered by file after they run. As in gitignore, a file inside an ignored directory cannot be re-included with `!`; ignore the files (`dir/*`) instead. A missing or unreadable `.muraqibignore` is treated as empty. The v1 `muraqib` command does not read `.muraqibignore`.
