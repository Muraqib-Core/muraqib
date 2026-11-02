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
- `fix --apply`: needs a git repository, a clean working tree and an interactive terminal. It creates a new branch and asks `[y/N]` for every fix.
- **Secrets are never written anywhere.** Fixes that remove a secret are verified but left out of the patch file, because a diff would contain the removed value; they are applied only with `--apply`. Reports, warnings and descriptions mention the location and type only.
- The `process.env.NAME` replacement is typed `string | undefined`; adjust types if your code expects `string`.

## Gemini (optional)

- Off by default. It runs only with `plan --explain`, and only if `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set in the environment. The key is never read from or written to a file.
- Needs the optional package `@google/genai`. Without it, or without a key, `--explain` falls back to built-in explanations and says so.
- Model: `gemini-2.5-flash`, set in one place (`explain/config.ts`).
- What is sent: for the top N steps (default 10, `--explain-top`), the issue code, severity, file, line and a redacted description, in **one** batched request. File contents are never sent. Credentials, `KEY=value` assignments, URL credentials and bearer tokens are replaced with `[REDACTED]`, and if anything that looks like a secret is still in the prompt, nothing is sent.
- Limits: at most 3 requests per run; up to 2 retries after HTTP 429 (waits 1 s then 2 s); then it falls back to the built-in text. Results are cached on disk in `~/.cache/muraqib-agent` (override with `MURAQIB_AGENT_CACHE_DIR`), keyed by model, language and issue id, so the same issue is not sent twice.
- Gemini only writes explanations. It never edits code and never decides whether a fix is accepted: fixes are identical with or without a key.
- Free-tier quotas belong to Google and change; check them in Google AI Studio.

## Known limits

- The floating-promise detection comes from v1's line-based heuristics, so it finds simple cases (`fetch(...)`, a call to a same-file `async` function) and misses others.
- Environment-variable and secret detection are pattern based (`process.env.X`, known token formats); destructured `process.env` and unknown token formats are not seen.
- The fixers are conservative: when a line is ambiguous (two literals, a template with `${}`, a multi-line key) they skip it.
- Fixes are checked by the Muraqib audit, not by your tests. Run your own checks before merging.

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
