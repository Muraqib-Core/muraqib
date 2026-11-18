# agent-v2 fixer evaluation

Reproduce with `muraqib-agent eval` (add `--json` for raw numbers). No network and no API key are used.

## What is measured

Three synthetic projects are created in a temp folder, each with planted problems and a ground truth written *before* running the fixers. The fixers run in apply mode (every fix approved), then each planted problem is checked against the final files:

- expected **fix**: counted correct only if the fix was accepted by the re-audit **and** the ground truth holds (for example the statement now has `await`, the secret value is gone and replaced by `process.env.NAME`, `.env.example` lists `NAME=` with no value);
- expected **decision / skip**: counted correct only if the code was left byte-identical and the user was asked (or the case was skipped);
- **wrongly fixed**: an accepted fix that fails its ground truth, or any edit where a decision/skip was expected. This number must be 0.

## Result (one run)

| project | planted | expected fix | fixed correctly | wrongly fixed | asked / kept | missed | issues before → after |
|---|---|---|---|---|---|---|---|
| api-basic | 9 | 9 | 9 | 0 | 0 | 0 | 17 → 11 |
| worker-partial | 4 | 4 | 4 | 0 | 0 | 0 | 15 → 11 |
| tricky | 7 | 1 | 1 | 0 | 6 | 0 | 21 → 20 |
| **total** | **20** | **14** | **14 (14/14)** | **0 (0/20)** | **6 (6/6)** | **0** | **53 → 42** |

"Issues after" stays high because most of the remaining issues are ones agent-v2 does not fix (for example missing `package.json` fields, config files) or the cases in `tricky` that are deliberately left for a human.

## On code the fixers were not written for

Two runs of `muraqib-agent fix --verify-cmd "npx tsc --noEmit" --max-fixes 10` (propose mode, nothing written to the project) on this repository itself, 3 November 2026, Linux. It is one codebase, not a rate.

| | before the comment/string filter | after |
|---|---|---|
| secret fixes proposed | 5 | 1 |
| of those, rejected by `--verify-cmd` (broke the strict type-check) | 2 | 1 |
| of those, `verified` but not a real secret | 3 | 0 |
| variables proposed for `.env.example` | 19 (including `A`, `B`, `X`, `NAME`) | 6, all real reads (`PORT`, `NO_COLOR`, `XDG_CACHE_HOME`, ...) |
| wall time | 53 s | 23 s |

- **`--verify-cmd` worked as intended.** The secret fixes that passed the audit but broke the type-check (`string | undefined` is not assignable to `string`) were rejected with the compiler output. With the audit alone they would have been accepted.
- **What the first run found, and what changed.** The secret detector matched documentation comments (`password = "..."` in a JSDoc line) and a table of detector patterns (`-----BEGIN CERTIFICATE-----`), and the env detector counted `process.env.X` written inside strings and comments. Now `process.env.X` inside a comment or a string literal is not a usage (inside `${}` it still is), public certificates are not reported, a weak hit on a comment-only line is dropped (a known-format key in a comment is still reported), and the fixer never rewrites a line that is a comment: it asks you to delete the key and rotate it. The scanner behind this (`detectors/code-mask.ts`) is a small tokenizer, not a parser; a wrong guess only affects the text around it.
- **One false positive remains.** The English words "Bearer authentication token" in a description string match v1's bearer-token pattern. In this run `--verify-cmd` rejected that fix, but without it a person would have to say no at the `[y/N]` question. Fixes that remove a secret are never written to the patch file and are applied only with `--apply`.

## With and without a Gemini key

- **Without a key:** measured, as above. Explanations are the built-in templates (53 of 53 steps explained).
- **With a key:** **checked once by hand, not measured.** The built-in evaluation harness never uses the network and had no key, so the table above says nothing about Gemini. Separately, one manual run with a real free key (2 November 2026, Windows, `muraqib-agent plan --explain --lang ar --max-steps 3`) ended in `llm` mode with 1 request for 3 steps, and each step got its own explanation instead of the generic template. That is one run on three steps: the quality and accuracy of Gemini explanations over many issues has not been evaluated, a second run served from the cache is covered by automated tests (mocked) but was not recorded against the real service, and the retry after a 503 has only been tested with mocks. Gemini only writes explanations and never edits code or decides whether a fix is accepted, so the fix numbers are the same with or without a key by design.
- **What the first real run found:** the original default model `gemini-2.5-flash` answered HTTP 404 (as did `gemini-2.5-flash-lite`) even though both were still listed for the key, and two other models answered a temporary 503. The default is now the alias `gemini-flash-lite-latest`, 503 is retried, and `MURAQIB_AGENT_MODEL` overrides the model. Mocked tests could not have found this.

## How much to trust these numbers

- The projects and the ground truth were written by the same team that wrote the fixers, 20 planted problems in total. This shows the fixers do what they were designed to do on known cases. It does not estimate how often they will be right on your code.
- The first run of this harness found one real miss (a password assignment, `adminPassword = "..."`), caused by the fixer's own probe value being read by the secret detector as a real password. It was fixed and a regression test was added; the table above is the run after that fix.
- Fixes are verified by the Muraqib audit, not by a project's own tests or by a type-check.
