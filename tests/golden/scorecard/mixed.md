![Security Score](https://img.shields.io/badge/security%20score-81%2F100%20(B)-green)

# Muraqib Security Scorecard

**Overall score: 81/100 (grade B)**

## Severity breakdown

| Severity | Findings | Penalty |
| --- | ---: | ---: |
| Critical | 0 | 0 |
| High | 1 | -10 |
| Medium | 2 | -8 |
| Low | 1 | -1 |

_1 informational finding(s) are not scored._

## Domain breakdown

| Domain | Score | Grade | Critical / High / Medium / Low |
| --- | ---: | :---: | :---: |
| Security | 90/100 | A | 0 / 1 / 0 / 0 |
| Dependencies | 96/100 | A | 0 / 0 / 1 / 0 |
| Code Quality | 95/100 | A | 0 / 0 / 1 / 1 |

## Blocking findings

- **High** · Missing HSTS header · `security-guard`

## Method

Starting from 100, each finding subtracts 25 (critical), 10 (high), 4 (medium), 1 (low); the score never goes below 0. Any critical finding caps the score at 59. Informational findings are not scored.

Modules evaluated: `security-guard`, `scan`, `async-guard`. Modules that were not run do not affect the score.
