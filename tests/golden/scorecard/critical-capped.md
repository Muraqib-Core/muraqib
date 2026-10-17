![Security Score](https://img.shields.io/badge/security%20score-59%2F100%20(F)-red)

# Muraqib Security Scorecard

**Overall score: 59/100 (grade F)**

> ⚠️ **Score capped at 59.** At least one critical finding exists, so the score cannot exceed 59 (it would be 61 otherwise).

## Severity breakdown

| Severity | Findings | Penalty |
| --- | ---: | ---: |
| Critical | 1 | -25 |
| High | 1 | -10 |
| Medium | 1 | -4 |
| Low | 0 | 0 |

## Domain breakdown

| Domain | Score | Grade | Critical / High / Medium / Low |
| --- | ---: | :---: | :---: |
| Security | 59/100 | F | 1 / 1 / 0 / 0 |
| Dependencies | 96/100 | A | 0 / 0 / 1 / 0 |
| Code Quality | 100/100 | A | 0 / 0 / 0 / 0 |

## Blocking findings

- **Critical** · Hardcoded API key (`src/config.ts:12`) · `security-guard`
- **High** · Missing CSP header · `security-guard`

## Method

Starting from 100, each finding subtracts 25 (critical), 10 (high), 4 (medium), 1 (low); the score never goes below 0. Any critical finding caps the score at 59. Informational findings are not scored.

Modules evaluated: `security-guard`, `dependency-guard`, `memory-guard`. Modules that were not run do not affect the score.
