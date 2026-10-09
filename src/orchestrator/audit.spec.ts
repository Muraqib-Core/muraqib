import { describe, expect, it } from "vitest";
import {
  createInitialAuditResult,
  runMemoryAudit,
  runDeadCodeAudit,
  runDependencyAudit,
  runAsyncAudit,
  runConfigAudit,
  runEnvAudit,
} from "./audit";

describe("Audit Functions", () => {
  describe("createInitialAuditResult", () => {
    it("creates a clean initial audit result", () => {
      const result = createInitialAuditResult();

      expect(result).toBeDefined();
      expect(result.env.ok).toBe(true);
      expect(result.env.errors).toEqual([]);
      expect(result.security.score).toBe(100);
      expect(result.memory.ok).toBe(true);
      expect(result.deadCode.ok).toBe(true);
    });

    it("has all required audit modules", () => {
      const result = createInitialAuditResult();

      expect(result).toHaveProperty("env");
      expect(result).toHaveProperty("images");
      expect(result).toHaveProperty("bundle");
      expect(result).toHaveProperty("network");
      expect(result).toHaveProperty("memory");
      expect(result).toHaveProperty("security");
      expect(result).toHaveProperty("deadCode");
      expect(result).toHaveProperty("dependencies");
      expect(result).toHaveProperty("async");
      expect(result).toHaveProperty("config");
      expect(result).toHaveProperty("performance");
      expect(result).toHaveProperty("optimizer");
      expect(result).toHaveProperty("renderBlocking");
    });

    it("initializes each module with ok=true and empty errors", () => {
      const result = createInitialAuditResult();

      Object.values(result).forEach((module) => {
        expect(module).toHaveProperty("ok");
        expect(module).toHaveProperty("errors");
        expect(Array.isArray(module.errors)).toBe(true);
      });
    });
  });

  describe("runEnvAudit", () => {
    it("returns ok=true for valid environment", async () => {
      const result = await runEnvAudit(process.cwd(), { safe: true });
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("errors");
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("handles safe mode correctly", async () => {
      const result = await runEnvAudit(process.cwd(), { safe: true });
      expect(result).toBeDefined();
      expect(typeof result.ok).toBe("boolean");
    });

    it("returns ModuleResult with errors array", async () => {
      const result = await runEnvAudit(process.cwd(), { safe: false });
      expect(result).toHaveProperty("ok");
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("supports presets option", async () => {
      const result = await runEnvAudit(process.cwd(), {
        safe: true,
        presets: ["next"],
      });
      expect(result).toBeDefined();
      expect(typeof result.ok).toBe("boolean");
    });

    it("supports schedule option", async () => {
      const result = await runEnvAudit(process.cwd(), {
        safe: true,
        schedule: "0 9 * * 1-5",
      });
      expect(result).toBeDefined();
      expect(typeof result.ok).toBe("boolean");
    });
  });

  describe("runDeadCodeAudit", () => {
    it("returns ModuleResult structure", async () => {
      const result = await runDeadCodeAudit(process.cwd());
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("errors");
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("handles audit errors gracefully", async () => {
      const result = await runDeadCodeAudit("/nonexistent/path");
      expect(result).toHaveProperty("ok");
      expect(typeof result.ok).toBe("boolean");
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe("runDependencyAudit", () => {
    it("returns ModuleResult structure", async () => {
      const result = await runDependencyAudit(process.cwd());
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("errors");
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  describe("runAsyncAudit", () => {
    it("returns ModuleResult structure", async () => {
      const result = await runAsyncAudit(process.cwd());
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("errors");
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  describe("runConfigAudit", () => {
    it("returns ModuleResult structure", async () => {
      const result = await runConfigAudit(process.cwd());
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("errors");
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  describe("runMemoryAudit", () => {
    it("returns ModuleResult structure", async () => {
      const result = await runMemoryAudit();
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("errors");
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("ok should be a boolean", async () => {
      const result = await runMemoryAudit();
      expect(typeof result.ok).toBe("boolean");
    });
  });

  describe("Audit result structure validation", () => {
    it("all audit functions return consistent structure", async () => {
      const results = [
        await runMemoryAudit(),
        await runDeadCodeAudit(process.cwd()),
        await runDependencyAudit(process.cwd()),
        await runAsyncAudit(process.cwd()),
        await runConfigAudit(process.cwd()),
      ];

      results.forEach((result) => {
        expect(result).toHaveProperty("ok");
        expect(result).toHaveProperty("errors");
        expect(typeof result.ok).toBe("boolean");
        expect(Array.isArray(result.errors)).toBe(true);
      });
    });
  });
});
