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

## With and without a Gemini key

- **Without a key:** measured, as above. Explanations are the built-in templates (53 of 53 steps explained).
- **With a key:** **checked once by hand, not measured.** The built-in evaluation harness never uses the network and had no key, so the table above says nothing about Gemini. Separately, one manual run with a real free key (2 November 2026, Windows, `muraqib-agent plan --explain --lang ar --max-steps 3`) ended in `llm` mode with 1 request for 3 steps, and each step got its own explanation instead of the generic template. That is one run on three steps: the quality and accuracy of Gemini explanations over many issues has not been evaluated, a second run served from the cache has not been confirmed, and the retry after a 503 has only been tested with mocks. Gemini only writes explanations and never edits code or decides whether a fix is accepted, so the fix numbers are the same with or without a key by design.
- **What the first real run found:** the original default model `gemini-2.5-flash` answered HTTP 404 (as did `gemini-2.5-flash-lite`) even though both were still listed for the key, and two other models answered a temporary 503. The default is now the alias `gemini-flash-lite-latest`, 503 is retried, and `MURAQIB_AGENT_MODEL` overrides the model. Mocked tests could not have found this.

## How much to trust these numbers

- The projects and the ground truth were written by the same team that wrote the fixers, 20 planted problems in total. This shows the fixers do what they were designed to do on known cases. It does not estimate how often they will be right on your code.
- The first run of this harness found one real miss (a password assignment, `adminPassword = "..."`), caused by the fixer's own probe value being read by the secret detector as a real password. It was fixed and a regression test was added; the table above is the run after that fix.
- Fixes are verified by the Muraqib audit, not by a project's own tests or by a type-check.
