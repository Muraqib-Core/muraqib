/**
 * Single central configuration for the optional Gemini explainer.
 * Everything that costs quota or controls what is sent lives here.
 */

/** The only model agent-v2 talks to (free tier). Change it here and nowhere else. */
export const GEMINI_MODEL = "gemini-2.5-flash" as const;

/** How many of the top-ranked plan steps are explained per run (one batched call). */
export const DEFAULT_EXPLAIN_TOP = 10;
/** Largest value accepted for the number of steps explained per run. */
export const MAX_EXPLAIN_TOP = 25;

/** Hard ceiling on API requests per run, retries included. */
export const DEFAULT_MAX_CALLS = 3;
/** Retries after an HTTP 429 (so at most 1 + 2 requests with the default ceiling). */
export const DEFAULT_MAX_RETRIES = 2;
/** First back-off delay in ms; doubles on every retry. */
export const RETRY_BASE_DELAY_MS = 1000;

/** Longest explanation kept per step, in characters. */
export const MAX_EXPLANATION_LENGTH = 400;
/** Cap on the number of cached explanations on disk. */
export const MAX_CACHE_ENTRIES = 500;
/** Override of the cache folder (tests, CI). */
export const CACHE_DIR_ENV = "MURAQIB_AGENT_CACHE_DIR" as const;

/** Languages the explainer can answer in: English or Arabic. */
export type ExplainLang = "en" | "ar";
/** Language used when none is requested. */
export const DEFAULT_LANG: ExplainLang = "en";
