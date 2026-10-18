import { test } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseEnvFile } from "../../src/scan/core/parsers/env-parser.js";

test("EnvParser: correctly parses standard key-value pairs and comments", () => {
  const tmpFile = path.join(os.tmpdir(), `env-test-${Date.now()}.env`);
  fs.writeFileSync(
    tmpFile,
    `
# Comment line
APP_NAME=Muraqib
PORT=3000
DEBUG="true"
`
  );

  try {
    const result = parseEnvFile(tmpFile);
    assert.equal(result.issues.length, 0);
    assert.equal(result.parsedData["APP_NAME"], "Muraqib");
    assert.equal(result.parsedData["PORT"], "3000");
    assert.equal(result.parsedData["DEBUG"], "true");
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("EnvParser: flags missing equals sign as validation error", () => {
  const tmpFile = path.join(os.tmpdir(), `env-test-missing-eq-${Date.now()}.env`);
  fs.writeFileSync(tmpFile, "INVALID_LINE_WITHOUT_EQUALS\n");

  try {
    const result = parseEnvFile(tmpFile);
    assert.ok(result.issues.some((i) => i.message.includes("Missing equals sign")));
    assert.ok(result.findings.some((f) => f.category === "validation" && f.level === "high"));
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("EnvParser: flags invalid key names starting with numbers", () => {
  const tmpFile = path.join(os.tmpdir(), `env-test-bad-key-${Date.now()}.env`);
  fs.writeFileSync(tmpFile, "123_INVALID=value\n");

  try {
    const result = parseEnvFile(tmpFile);
    assert.ok(result.issues.some((i) => i.message.includes("Invalid Environment Variable name")));
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("EnvParser: flags unquoted spaces in value", () => {
  const tmpFile = path.join(os.tmpdir(), `env-test-spaces-${Date.now()}.env`);
  fs.writeFileSync(tmpFile, "SPACED_VALUE=hello world without quotes\n");

  try {
    const result = parseEnvFile(tmpFile);
    assert.ok(result.issues.some((i) => i.message.includes("Values with spaces must be enclosed")));
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("EnvParser: flags duplicate keys with configuration category and low severity", () => {
  const tmpFile = path.join(os.tmpdir(), `env-test-dup-${Date.now()}.env`);
  fs.writeFileSync(tmpFile, "DUP_KEY=first\nDUP_KEY=second\n");

  try {
    const result = parseEnvFile(tmpFile);
    const dupFinding = result.findings.find((f) => f.key === "DUP_KEY" && f.category === "configuration");
    assert.ok(dupFinding, "Duplicate key finding not found");
    assert.equal(dupFinding.level, "low");
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("EnvParser: preserves hash characters inside quoted values", () => {
  const tmpFile = path.join(os.tmpdir(), `env-test-hash-${Date.now()}.env`);
  fs.writeFileSync(tmpFile, 'PASSWORD="abc#123" # comment\n');

  try {
    const result = parseEnvFile(tmpFile);
    assert.equal(result.parsedData["PASSWORD"], "abc#123");
    assert.equal(result.issues.length, 0);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("EnvParser: findings never serialize malformed secret values", () => {
  const tmpFile = path.join(os.tmpdir(), `env-test-redaction-${Date.now()}.env`);
  const secret = "super-secret-value";
  fs.writeFileSync(tmpFile, `API_KEY=${secret} with-space\n`);

  try {
    const result = parseEnvFile(tmpFile);
    assert.ok(result.findings.length > 0);
    assert.equal(JSON.stringify(result.findings).includes(secret), false);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("EnvParser: accepts an `export` prefix", () => {
  const tmpFile = path.join(os.tmpdir(), `env-test-export-${Date.now()}.env`);
  fs.writeFileSync(tmpFile, "export FOO=bar\nexport  QUOTED=\"a b\"\n");

  try {
    const result = parseEnvFile(tmpFile);
    assert.equal(result.findings.length, 0);
    assert.equal(result.parsedData["FOO"], "bar");
    assert.equal(result.parsedData["QUOTED"], "a b");
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("EnvParser: reads a multi-line quoted value as one entry", () => {
  const tmpFile = path.join(os.tmpdir(), `env-test-multiline-${Date.now()}.env`);
  fs.writeFileSync(tmpFile, 'PRIVATE_KEY="-----BEGIN KEY-----\nabc=\n-----END KEY-----"\r\nNEXT=1\n');

  try {
    const result = parseEnvFile(tmpFile);
    assert.equal(result.findings.length, 0);
    assert.equal(result.parsedData["PRIVATE_KEY"], "-----BEGIN KEY-----\nabc=\n-----END KEY-----");
    assert.equal(result.parsedData["NEXT"], "1");
    assert.equal(result.parsedLines.find((l) => l.key === "NEXT")?.line, 4);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("EnvParser: a quote that never closes is still reported", () => {
  const tmpFile = path.join(os.tmpdir(), `env-test-unclosed-${Date.now()}.env`);
  fs.writeFileSync(tmpFile, 'BROKEN="never closed\nOTHER=1\n');

  try {
    const result = parseEnvFile(tmpFile);
    assert.ok(result.findings.some((f) => f.code.endsWith("unmatched-quotes")));
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("EnvParser: findings use the display name instead of the absolute path", () => {
  const tmpFile = path.join(os.tmpdir(), `env-test-display-${Date.now()}.env`);
  fs.writeFileSync(tmpFile, "NOT A LINE\n");

  try {
    const result = parseEnvFile(tmpFile, ".env");
    const [finding] = result.findings;
    assert.equal(finding?.location?.file, ".env");
    assert.equal(finding?.code, "env-.env-1-missing-equals");
  } finally {
    fs.unlinkSync(tmpFile);
  }
});
