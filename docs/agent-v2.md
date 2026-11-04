---
title: Agent v2
type: reference
created: 2026-11-04
updated: 2026-11-04
sources:
  - code: src/agent-v2/cli.ts
verified_at: f39b88d
---

# 🛠️ Agent v2: ranked plan, verified fixes, optional Gemini

> Part of the [Muraqib documentation](../README.md). See also [ai.md](ai.md) and [cli.md](cli.md).

`muraqib-agent` is a separate command (v1 is unchanged). It turns the audit into an ordered plan and, for three problem types, into fixes that are proven by re-running the audit. See [`src/agent-v2/README.md`](../src/agent-v2/README.md) for details and [`EVALUATION.md`](../src/agent-v2/EVALUATION.md) for measured results.

```bash
muraqib-agent plan                       # ranked list of what to fix first; offline, no LLM
muraqib-agent plan --explain --lang ar   # + a short explanation per step (Gemini if a key is set)
muraqib-agent fix                        # writes muraqib-agent.patch with verified fixes; project untouched
muraqib-agent fix --apply                # applies on a new branch, asking before each fix; no commit
muraqib-agent pr-description             # PR text written from the real verification result
muraqib-agent eval                       # fixer accuracy on three built-in projects with known problems
```

Fixes: add a missing `await`; move a hardcoded secret to `process.env.NAME` (and document `NAME=` in `.env.example`); create or complete `.env.example`. A fix is kept only if its issue disappears and no new issue appears. Fixes that remove a secret are never written to the patch file (a diff would contain the secret); they are applied only with `--apply`, and you must rotate the exposed secret.

## Optional: Gemini explanations (free key)

Gemini is optional and only used by `plan --explain`; without a key you get the same plan with built-in explanations. It never edits code.

1. **Get a key:** open [Google AI Studio](https://aistudio.google.com/apikey), sign in with a Google account, choose **Create API key**, and copy it. The free tier has usage limits set by Google (they change; check AI Studio). On the free tier Google may use submitted content to improve its products; Muraqib sends only redacted issue metadata (code, severity, file, line, a redacted description), never file contents.
2. **Install the optional package** in the project where you run Muraqib: `npm i @google/genai`.
3. **Put the key in an environment variable, never in a file:**
   ```bash
   # macOS / Linux: this terminal session only (`read -s` keeps it off the screen and out of shell history)
   printf "Gemini key: "; read -rs GEMINI_API_KEY; echo; export GEMINI_API_KEY
   # Windows PowerShell
   $env:GEMINI_API_KEY = "<your key>"
   ```
   `GOOGLE_API_KEY` also works. Muraqib reads only the process environment, not `.env` files. To keep the key across sessions, set it in your OS or shell profile, not in the repository.
4. **Run and check:** `muraqib-agent plan --explain --lang ar`. The last lines should read `Explanations: llm (gemini-flash-lite-latest, 1 request(s), ...)`. A second run reads `cached` and makes 0 requests. If it says `fallback`, the note below it tells you why (no key, package missing, rate limit reached, or a request error).

Limits: one batched request for the top 10 steps (`--explain-top`), at most 3 requests per run, up to 2 retries after HTTP 429 or 503 (temporary overload), results cached in `~/.cache/muraqib-agent`. The default model is the alias `gemini-flash-lite-latest`, because Google retires named models (a retired model answers HTTP 404 even while it is still listed). To try another one without editing code: `$env:MURAQIB_AGENT_MODEL = "gemini-3.5-flash"` (PowerShell) or `export MURAQIB_AGENT_MODEL=gemini-3.5-flash`. Never commit your key or paste it into issues or chats.

If it prints `fallback`, the `Note:` line under it gives the reason (no key, package missing, retired model, key rejected, temporary overload, network). The full table and the commands to check which models your key can use are in [`src/agent-v2/README.md`](../src/agent-v2/README.md#if-it-says-fallback). A real-key run has been checked once by hand; see [`EVALUATION.md`](../src/agent-v2/EVALUATION.md) for what is and is not measured.
