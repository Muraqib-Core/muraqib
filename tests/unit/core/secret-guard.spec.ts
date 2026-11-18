import { describe, expect, test } from "vitest";
import { BaseGuard } from "../../../src/core/base-guard.js";
import { SECRET_IGNORE_MARKER, SecretGuard, isScannableFile } from "../../../src/core/secret-guard.js";
import type { SecretScanTarget } from "../../../src/core/secret-guard.js";
import { calculateScorecard, classifyIssue } from "../../../src/core/scorecard.js";

const STRIPE = `sk_live_${"aB3".repeat(8)}`;
const PUBLISHABLE = `pk_live_${"aB3".repeat(8)}`;

const target = (file: string, ...texts: string[]): SecretScanTarget => ({
  file,
  lines: texts.map((text, index) => ({ line: index + 1, text })),
});

const scan = (...targets: SecretScanTarget[]) => new SecretGuard({ targets }).run();

describe("SecretGuard", () => {
  test("is a BaseGuard named secret-guard", () => {
    const guard = new SecretGuard({ targets: [] });
    expect(guard).toBeInstanceOf(BaseGuard);
    expect(guard.getModule()).toBe("secret-guard");
  });

  test("is ok when there is nothing to scan or nothing found", async () => {
    expect(await scan()).toMatchObject({ status: "ok", issues: [], message: "No secrets found" });
    expect(await scan(target("a.ts", "const a = 1;"))).toMatchObject({ status: "ok" });
  });

  test("a live token is a critical, blocking issue with an exact location and no raw secret", async () => {
    const result = await scan(target("src/pay.ts", "// header", `const key = "${STRIPE}";`));
    expect(result.status).toBe("error");
    expect(result.issues).toHaveLength(1);
    const [issue] = result.issues;
    expect(issue).toMatchObject({
      code: "SECRET_API_KEY",
      severity: "critical",
      module: "secret-guard",
      location: { file: "src/pay.ts", line: 2 },
    });
    expect(JSON.stringify(result)).not.toContain(STRIPE);
    expect(result.message).toBe("1 secret(s) found that block the change");
  });

  test("ambiguous or public-by-design findings are warnings, not blockers", async () => {
    const result = await scan(target("a.ts", `const k = "${PUBLISHABLE}";`, `password = "hunter2hunter2"`));
    expect(result.status).toBe("warning");
    expect(result.issues.map((i) => i.severity)).toEqual(["warning", "warning"]);
    expect(result.message).toBe("2 possible secret(s) found");
  });

  test("a line with the ignore marker is skipped", async () => {
    const result = await scan(target("a.ts", `const key = "${STRIPE}"; // ${SECRET_IGNORE_MARKER}`));
    expect(result.issues).toEqual([]);
  });

  test("placeholder assignments and numeric heuristics are not reported", async () => {
    const result = await scan(target("a.ts", `password = "<your-password>"`, "order 12345 678 99"));
    expect(result.issues).toEqual([]);
  });

  test("a secret matching several rules is reported once, as the strongest", async () => {
    const result = await scan(target("a.ts", `DB_PASSWORD = "Zq8rT2vLmN4xPw"`));
    expect(result.issues.map((i) => i.code)).toEqual(["SECRET_DB_CREDENTIAL"]);
  });

  test("lockfiles, minified bundles and binaries are not scanned", async () => {
    const line = `"integrity": "${STRIPE}"`;
    const result = await scan(target("package-lock.json", line), target("dist/app.min.js", line), target("logo.png", line), target("a.js.map", line));
    expect(result.issues).toEqual([]);
    expect(isScannableFile("src/a.ts")).toBe(true);
    expect(isScannableFile("deep/dir/yarn.lock")).toBe(false);
  });

  test("very long (generated) lines are skipped", async () => {
    const long = `${"x".repeat(2100)} ${STRIPE}`;
    expect((await scan(target("bundle.ts", long))).issues).toEqual([]);
    const custom = await new SecretGuard({ targets: [target("bundle.ts", long)], maxLineLength: 5000 }).run();
    expect(custom.issues).toHaveLength(1);
  });

  describe("environment files", () => {
    test("a real-looking value in .env blocks, and the value is never reported", async () => {
      const value = "Zq8rT2vLmN4xPw7Yb3KcHd9Ge5Fs";
      const result = await scan(target(".env", "NODE_ENV=production", `SESSION_SIGNING_KEY=${value}`));
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({ code: "SECRET_ENV_VALUE", severity: "critical", location: { file: ".env", line: 2 } });
      expect(JSON.stringify(result)).not.toContain(value);
    });

    test("placeholders and non-secret settings in .env are fine", async () => {
      const result = await scan(target(".env.local", "API_TOKEN=<your-token>", "PORT=3000", "DEBUG=true", "# SECRET_KEY=Zq8rT2vLmN4xPw7Yb3KcHd9Ge5Fs"));
      expect(result.issues).toEqual([]);
    });

    test("templates such as .env.example are not treated as env files", async () => {
      const result = await scan(target(".env.example", "SESSION_SIGNING_KEY=Zq8rT2vLmN4xPw7Yb3KcHd9Ge5Fs"));
      expect(result.issues).toEqual([]);
    });

    test("a line already reported as a token is not reported twice", async () => {
      const result = await scan(target(".env", `STRIPE_KEY=${STRIPE}`));
      expect(result.issues.map((i) => i.code)).toEqual(["SECRET_API_KEY"]);
    });
  });

  test("a change larger than the scan budget is partially scanned and says so, without blocking", async () => {
    const guard = new SecretGuard({
      targets: [target("a.ts", "x".repeat(50)), target("b.ts", `const k = "${STRIPE}";`)],
      maxScanChars: 10,
    });
    const result = await guard.run();
    expect(result.issues.map((i) => i.code)).toEqual(["SECRET_SCAN_INCOMPLETE"]);
    expect(result.status).toBe("warning");
  });

  test("issues feed the scorecard as Security findings", async () => {
    const result = await scan(target("a.ts", `const key = "${STRIPE}";`));
    const findings = result.issues.map(classifyIssue);
    expect(findings).toEqual([{ severity: "critical", domain: "security" }]);
    expect(calculateScorecard(findings).score).toBe(59);
  });
});
