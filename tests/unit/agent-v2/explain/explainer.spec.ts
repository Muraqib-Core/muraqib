import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MissingOptionalDependencyError } from "../../../../src/utils/optional-dependency.js";
import { ExplainCache } from "../../../../src/agent-v2/explain/cache.js";
import { MAX_EXPLANATION_LENGTH, GEMINI_MODEL } from "../../../../src/agent-v2/explain/config.js";
import { buildPrompt, explainPlan } from "../../../../src/agent-v2/explain/explainer.js";
import type { TextGenerator } from "../../../../src/agent-v2/explain/gemini.js";
import { templateExplanation } from "../../../../src/agent-v2/explain/templates.js";
import type { AgentPlan, FixClass, PlanStep } from "../../../../src/agent-v2/types.js";

const hoisted = vi.hoisted(() => ({ createGeminiClient: vi.fn() }));
vi.mock("../../../../src/ai/gemini-client.js", () => ({ createGeminiClient: hoisted.createGeminiClient }));

const FAKE_KEY = ["fake", "gemini", "key", "Zx9Yw8Vu7Ts6"].join("-");
const FAKE_SECRET = ["sk", "live", "A1b2C3d4E5f6G7h8I9j0K1l2"].join("_");
const FAKE_BEARER = ["Bearer", ["abcdefghij", "klmnopqrst", "uvwxyz0123456789"].join("")].join(" ");

const step = (n: number, over: Partial<PlanStep> = {}): PlanStep => ({
  rank: n,
  issueId: `id-${n}`,
  module: "async-guard",
  code: "ASYNC_FLOATING_PROMISE",
  severity: "warning",
  title: `Finding ${n}`,
  fixClass: "floating-promise",
  autoFixable: true,
  file: `src/f${n}.ts`,
  line: n,
  reasons: ["r"],
  ...over,
});

const makePlan = (count: number, over: (n: number) => Partial<PlanStep> = () => ({})): AgentPlan => ({
  schemaVersion: "1.0",
  projectRoot: "/tmp/x",
  verdict: "fail",
  ok: true,
  summary: {
    total: count,
    autoFixable: count,
    manual: 0,
    byFixClass: { "floating-promise": count, "hardcoded-secret": 0, "env-documentation": 0, manual: 0 },
  },
  steps: Array.from({ length: count }, (_, i) => step(i + 1, over(i + 1))),
});

const reply = (ids: string[], text = "Explained."): string =>
  JSON.stringify({ explanations: ids.map((id) => ({ id, text: `${text} ${id}` })) });

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `id-${i + 1}`);

let cacheDir: string;
let cache: ExplainCache;
let sleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;
let saved: { g: string | undefined; k: string | undefined };

const mockGen = (impl: (req: { system: string; prompt: string }) => Promise<string>) => {
  const generate = vi.fn(impl);
  const generator: TextGenerator = { generate };
  return { generate, generator };
};
const rateLimit = (): Error & { status: number } => Object.assign(new Error("quota"), { status: 429 });

beforeEach(() => {
  saved = { g: process.env.GEMINI_API_KEY, k: process.env.GOOGLE_API_KEY };
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  cacheDir = mkdtempSync(join(tmpdir(), "agent-v2-explain-"));
  cache = new ExplainCache(cacheDir);
  sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  hoisted.createGeminiClient.mockReset();
});
afterEach(() => {
  if (saved.g === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = saved.g;
  if (saved.k === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = saved.k;
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("explainPlan without a key", () => {
  test("falls back to English templates and never calls the generator-factory", async () => {
    const plan = makePlan(3, (n) => ({ fixClass: (["floating-promise", "hardcoded-secret", "env-documentation"] as FixClass[])[n - 1] as FixClass }));
    const out = await explainPlan(plan, {}, { cache, sleep });
    expect(out.explainer?.mode).toBe("fallback");
    expect(out.explainer?.calls).toBe(0);
    expect(out.explainer?.notice).toMatch(/GEMINI_API_KEY/);
    expect(out.steps.map((s) => s.explanation)).toEqual([
      templateExplanation("floating-promise", "en"),
      templateExplanation("hardcoded-secret", "en"),
      templateExplanation("env-documentation", "en"),
    ]);
    expect(hoisted.createGeminiClient).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  test("Arabic templates with --lang ar", async () => {
    const out = await explainPlan(makePlan(2), { lang: "ar" }, { cache, sleep });
    expect(out.explainer?.mode).toBe("fallback");
    expect(out.steps[0]?.explanation).toBe(templateExplanation("floating-promise", "ar"));
    expect(out.steps[0]?.explanation).toMatch(/[؀-ۿ]/);
    expect(out.steps[0]?.explanation).not.toBe(templateExplanation("floating-promise", "en"));
  });

  test("an injected generator is used even without a key (deps.generator wins)", async () => {
    // Injected generator without key still runs (deps.generator wins); documents the contract.
    const { generate, generator } = mockGen(async () => reply(ids(1)));
    const out = await explainPlan(makePlan(1), {}, { generator, cache, sleep });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(out.explainer?.mode).toBe("llm");
  });

  test("does not mutate the input plan and keeps step order", async () => {
    const plan = makePlan(3);
    const before = JSON.stringify(plan);
    const out = await explainPlan(plan, {}, { cache, sleep });
    expect(JSON.stringify(plan)).toBe(before);
    expect(out.steps.map((s) => s.issueId)).toEqual(ids(3));
  });

  test("empty plan reports nothing to explain", async () => {
    const out = await explainPlan(makePlan(0), {}, { cache, sleep });
    expect(out.explainer?.mode).toBe("fallback");
    expect(out.explainer?.notice).toMatch(/Nothing to explain/);
  });
});

describe("explainPlan with a key and a mock generator", () => {
  test("one batched call for N steps, mode llm, results cached", async () => {
    const { generate, generator } = mockGen(async () => reply(ids(5)));
    const out = await explainPlan(makePlan(5), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(out.explainer).toMatchObject({ mode: "llm", calls: 1, cached: 0 });
    expect(out.steps.map((s) => s.explanation)).toEqual(ids(5).map((id) => `Explained. ${id}`));
    expect(new ExplainCache(cacheDir).get(`${GEMINI_MODEL}:en:id-1`)).toBeDefined();
  });

  test("second run is served from cache with zero calls", async () => {
    const first = mockGen(async () => reply(ids(3)));
    await explainPlan(makePlan(3), {}, { generator: first.generator, apiKey: FAKE_KEY, cache, sleep });
    const second = mockGen(async () => reply(ids(3), "NEW"));
    const out = await explainPlan(makePlan(3), {}, { generator: second.generator, apiKey: FAKE_KEY, cache: new ExplainCache(cacheDir), sleep });
    expect(second.generate).not.toHaveBeenCalled();
    expect(out.explainer).toMatchObject({ mode: "cached", calls: 0, cached: 3 });
    expect(out.steps[0]?.explanation).toBe("Explained. id-1");
  });

  test("cache is per language", async () => {
    const en = mockGen(async () => reply(ids(1)));
    await explainPlan(makePlan(1), { lang: "en" }, { generator: en.generator, apiKey: FAKE_KEY, cache, sleep });
    const ar = mockGen(async () => reply(ids(1), "AR"));
    const out = await explainPlan(makePlan(1), { lang: "ar" }, { generator: ar.generator, apiKey: FAKE_KEY, cache, sleep });
    expect(ar.generate).toHaveBeenCalledTimes(1);
    expect(out.steps[0]?.explanation).toBe("AR id-1");
    expect(ar.generate.mock.calls[0]?.[0].prompt).toContain("Arabic");
  });

  test("partial cache hit only sends the missing steps", async () => {
    cache.set(`${GEMINI_MODEL}:en:id-1`, "cached one");
    const { generate, generator } = mockGen(async () => reply(["id-2"]));
    const out = await explainPlan(makePlan(2), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    const prompt = generate.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("id-2");
    expect(prompt).not.toContain("id-1");
    expect(out.explainer).toMatchObject({ mode: "llm", cached: 1 });
    expect(out.steps[0]?.explanation).toBe("cached one");
  });

  test("prompt never contains a secret from detail/title or the key itself", async () => {
    const plan = makePlan(2, (n) =>
      n === 1
        ? { detail: `Hardcoded value ${FAKE_SECRET} in config`, title: `Found ${FAKE_SECRET}` }
        : { detail: `Uses key ${FAKE_KEY} directly` }
    );
    const { generate, generator } = mockGen(async () => reply(ids(2)));
    const out = await explainPlan(plan, {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(generate).toHaveBeenCalledTimes(1);
    const { prompt, system } = generate.mock.calls[0]?.[0] ?? { prompt: "", system: "" };
    expect(prompt).not.toContain(FAKE_SECRET);
    expect(prompt).not.toContain(FAKE_KEY);
    expect(system).not.toContain(FAKE_KEY);
    expect(prompt).toContain("[REDACTED]");
    expect(out.explainer?.mode).toBe("llm");
  });

  test("buildPrompt redacts and sends metadata only", () => {
    const prompt = buildPrompt([step(1, { detail: `x ${FAKE_SECRET}` })], "en", [FAKE_KEY]);
    expect(prompt).not.toContain(FAKE_SECRET);
    expect(prompt).toContain("id-1");
    expect(prompt).toContain("src/f1.ts");
  });

  test("leak guard: a secret surviving redaction aborts the call", async () => {
    const plan = makePlan(1, () => ({ detail: `cert ${["-----BEGIN", "CERTIFICATE-----"].join(" ")} end` }));
    const { generate, generator } = mockGen(async () => reply(ids(1)));
    const out = await explainPlan(plan, {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(generate).not.toHaveBeenCalled();
    expect(out.explainer?.mode).toBe("fallback");
    expect(out.explainer?.notice).toMatch(/secret/i);
    expect(out.steps[0]?.explanation).toBe(templateExplanation("floating-promise", "en"));
  });

  test("top limits how many steps are sent", async () => {
    const { generate, generator } = mockGen(async () => reply(ids(2)));
    const out = await explainPlan(makePlan(6), { top: 2 }, { generator, apiKey: FAKE_KEY, cache, sleep });
    const prompt = generate.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("id-1");
    expect(prompt).toContain("id-2");
    expect(prompt).not.toContain("id-3");
    expect(out.steps).toHaveLength(6);
    // Steps beyond `top` are returned untouched (no explanation attached).
    expect(out.steps[2]?.explanation).toBeUndefined();
    expect(out.steps[1]?.explanation).toBe("Explained. id-2");
  });

  test("top=0 explains nothing and does not call", async () => {
    const { generate, generator } = mockGen(async () => reply(ids(1)));
    const out = await explainPlan(makePlan(3), { top: 0 }, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(generate).not.toHaveBeenCalled();
    expect(out.steps).toHaveLength(3);
  });

  test("top is clamped to the maximum", async () => {
    const { generate, generator } = mockGen(async () => reply(ids(40)));
    await explainPlan(makePlan(40), { top: 1000 }, { generator, apiKey: FAKE_KEY, cache, sleep });
    const prompt = generate.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain('"id-25"');
    expect(prompt).not.toContain('"id-26"');
  });
});

describe("rate limits and errors", () => {
  test("429 twice then success: sleeps 1000 then 2000, mode llm", async () => {
    let n = 0;
    const { generate, generator } = mockGen(async () => {
      n += 1;
      if (n < 3) throw rateLimit();
      return reply(ids(2));
    });
    const out = await explainPlan(makePlan(2), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
    expect(out.explainer).toMatchObject({ mode: "llm", calls: 3 });
  });

  test("429 detected from message text too", async () => {
    let n = 0;
    const { generator } = mockGen(async () => {
      n += 1;
      if (n === 1) throw new Error("got RESOURCE_EXHAUSTED from api");
      return reply(ids(1));
    });
    const out = await explainPlan(makePlan(1), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(out.explainer?.mode).toBe("llm");
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  test("always 429: fallback with notice, calls bounded", async () => {
    const { generate, generator } = mockGen(async () => {
      throw rateLimit();
    });
    const out = await explainPlan(makePlan(2), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(out.explainer?.mode).toBe("fallback");
    expect(out.explainer?.notice).toMatch(/429/);
    expect(generate.mock.calls.length).toBeLessThanOrEqual(3);
    expect(out.explainer?.calls).toBe(generate.mock.calls.length);
    expect(out.steps.every((s) => s.explanation === templateExplanation("floating-promise", "en"))).toBe(true);
  });

  test("maxCalls=1 caps requests even on 429", async () => {
    const { generate, generator } = mockGen(async () => {
      throw rateLimit();
    });
    const out = await explainPlan(makePlan(2), { maxCalls: 1 }, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(out.explainer?.calls).toBe(1);
    expect(out.explainer?.mode).toBe("fallback");
  });

  test("maxRetries=0 does not retry", async () => {
    const { generate, generator } = mockGen(async () => {
      throw rateLimit();
    });
    await explainPlan(makePlan(1), { maxRetries: 0 }, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("non-429 error: fallback, one call, message not echoed", async () => {
    const leak = ["internal", "details", "do-not-print"].join("-");
    const { generate, generator } = mockGen(async () => {
      throw Object.assign(new Error(leak), { status: 500 });
    });
    const out = await explainPlan(makePlan(2), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(out.explainer?.mode).toBe("fallback");
    expect(JSON.stringify(out)).not.toContain(leak);
  });

  test("fallback results are not cached", async () => {
    const { generator } = mockGen(async () => {
      throw new Error("boom");
    });
    await explainPlan(makePlan(1), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(new ExplainCache(cacheDir).get(`${GEMINI_MODEL}:en:id-1`)).toBeUndefined();
  });
});

describe("reply parsing", () => {
  test("malformed JSON falls back", async () => {
    const { generator } = mockGen(async () => "this is { not json");
    const out = await explainPlan(makePlan(2), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(out.explainer?.mode).toBe("fallback");
    expect(out.explainer?.notice).toMatch(/no usable/i);
    expect(out.steps[0]?.explanation).toBe(templateExplanation("floating-promise", "en"));
  });

  test.each(['{"explanations":"nope"}', "null", "[]", '{"explanations":[1,null,{"id":5,"text":"x"}]}'])("odd shape %s falls back", async (body) => {
    const { generator } = mockGen(async () => body);
    const out = await explainPlan(makePlan(1), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(out.explainer?.mode).toBe("fallback");
  });

  test("unknown ids are ignored; known ones used; the rest use templates", async () => {
    const { generator } = mockGen(async () =>
      JSON.stringify({ explanations: [{ id: "id-1", text: "good" }, { id: "evil-id", text: "injected" }] })
    );
    const out = await explainPlan(makePlan(2), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(out.explainer?.mode).toBe("llm");
    expect(out.steps[0]?.explanation).toBe("good");
    expect(out.steps[1]?.explanation).toBe(templateExplanation("floating-promise", "en"));
    expect(JSON.stringify(out)).not.toContain("injected");
  });

  test("fenced JSON is accepted", async () => {
    const { generator } = mockGen(async () => "Here you go:\n```json\n" + reply(ids(1)) + "\n```");
    const out = await explainPlan(makePlan(1), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(out.explainer?.mode).toBe("llm");
    expect(out.steps[0]?.explanation).toBe("Explained. id-1");
  });

  test("over-long text is truncated", async () => {
    const { generator } = mockGen(async () => JSON.stringify({ explanations: [{ id: "id-1", text: "a".repeat(MAX_EXPLANATION_LENGTH * 3) }] }));
    const out = await explainPlan(makePlan(1), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(out.steps[0]?.explanation).toHaveLength(MAX_EXPLANATION_LENGTH);
  });

  test("secrets echoed by the model are redacted or dropped", async () => {
    const { generator } = mockGen(async () =>
      JSON.stringify({
        explanations: [
          { id: "id-1", text: `Rotate ${FAKE_SECRET} now` },
          { id: "id-2", text: `Header ${FAKE_BEARER}` },
        ],
      })
    );
    const out = await explainPlan(makePlan(2), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    const dump = JSON.stringify(out);
    expect(dump).not.toContain(FAKE_SECRET);
    expect(dump).not.toContain(FAKE_BEARER);
    expect(out.steps[1]?.explanation).toBe("Header [REDACTED]");
  });

  test("empty text entries are skipped", async () => {
    const { generator } = mockGen(async () => JSON.stringify({ explanations: [{ id: "id-1", text: "   " }] }));
    const out = await explainPlan(makePlan(1), {}, { generator, apiKey: FAKE_KEY, cache, sleep });
    expect(out.explainer?.mode).toBe("fallback");
  });
});

describe("missing optional dependency", () => {
  test("key set but @google/genai missing: fallback with notice", async () => {
    hoisted.createGeminiClient.mockRejectedValue(new MissingOptionalDependencyError("@google/genai", "Gemini"));
    const out = await explainPlan(makePlan(2), {}, { apiKey: FAKE_KEY, cache, sleep });
    expect(hoisted.createGeminiClient).toHaveBeenCalledTimes(1);
    expect(out.explainer?.mode).toBe("fallback");
    expect(out.explainer?.calls).toBe(0);
    expect(out.explainer?.notice).toMatch(/@google\/genai/);
    expect(out.steps[0]?.explanation).toBe(templateExplanation("floating-promise", "en"));
  });

  test("other client start-up failure: generic notice, no message echoed", async () => {
    const leak = ["secret", "startup", "msg"].join("-");
    hoisted.createGeminiClient.mockRejectedValue(new Error(leak));
    const out = await explainPlan(makePlan(1), {}, { apiKey: FAKE_KEY, cache, sleep });
    expect(out.explainer?.mode).toBe("fallback");
    expect(JSON.stringify(out)).not.toContain(leak);
  });

  test("key from environment (no deps.apiKey) reaches the client factory", async () => {
    process.env.GEMINI_API_KEY = FAKE_KEY;
    hoisted.createGeminiClient.mockRejectedValue(new MissingOptionalDependencyError("@google/genai", "Gemini"));
    await explainPlan(makePlan(1), {}, { cache, sleep });
    expect(hoisted.createGeminiClient).toHaveBeenCalledWith(FAKE_KEY);
  });
});
