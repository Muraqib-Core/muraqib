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
