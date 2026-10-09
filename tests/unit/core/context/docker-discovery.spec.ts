import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  discoverDockerConfig,
  findDockerFiles,
  isContainerized,
  getDockerFilePaths,
} from "../../../../src/core/context/docker-discovery.js";

vi.mock("fs");

describe("Docker Discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("discoverDockerConfig()", () => {
    it("should detect Dockerfile", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20-alpine\nRUN npm install"
      );

      const result = discoverDockerConfig("/test/project");

      expect(result.hasDocker).toBe(true);
      expect(result.dockerFileVariants.length).toBeGreaterThan(0);
    });

    it("should detect docker-compose.yml", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("docker-compose");
      });
      vi.mocked(readFileSync).mockReturnValue("");

      const result = discoverDockerConfig("/test/project");

      expect(result.hasDockerCompose).toBe(true);
    });

    it("should detect .dockerignore", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return (
          pathStr.includes(".dockerignore") ||
          pathStr.includes("Dockerfile")
        );
      });
      vi.mocked(readFileSync).mockReturnValue("node_modules\n.git");

      const result = discoverDockerConfig("/test/project");

      expect(result.hasDockerignore).toBe(true);
    });

    it("should extract base image from Dockerfile", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20.10.0-alpine\nRUN npm install"
      );

      const result = discoverDockerConfig("/test/project");

      expect(result.containerConfig.baseImage).toBe("node:20.10.0-alpine");
    });

    it("should detect HEALTHCHECK", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20-alpine\nHEALTHCHECK --interval=30s CMD node /healthcheck.js"
      );

      const result = discoverDockerConfig("/test/project");

      expect(result.containerConfig.hasHealthCheck).toBe(true);
    });

    it("should detect non-root user", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20-alpine\nRUN useradd -m appuser\nUSER appuser"
      );

      const result = discoverDockerConfig("/test/project");

      expect(result.containerConfig.runAsRoot).toBe(false);
    });

    it("should detect hardcoded secrets", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20-alpine\nENV PASSWORD=mysecret123"
      );

      const result = discoverDockerConfig("/test/project");

      expect(result.containerConfig.hasSecrets).toBe(true);
    });

    it("should return false for hasSecrets when using environment variables", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20-alpine\nENV PASSWORD=$PASSWORD"
      );

      const result = discoverDockerConfig("/test/project");

      expect(result.containerConfig.hasSecrets).toBe(false);
    });

    it("should return empty variants when no Docker files found", async () => {
      const { existsSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(false);

      const result = discoverDockerConfig("/test/project");

      expect(result.hasDocker).toBe(false);
      expect(result.dockerFileVariants).toHaveLength(0);
    });

    it("should detect multiple Dockerfile variants", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return (
          pathStr.includes("Dockerfile.dev") ||
          pathStr.includes("Dockerfile.prod")
        );
      });
      vi.mocked(readFileSync).mockReturnValue("FROM node:20-alpine");

      const result = discoverDockerConfig("/test/project");

      expect(result.dockerFileVariants.length).toBeGreaterThan(0);
    });
  });

  describe("findDockerFiles()", () => {
    it("should find Docker-related files", async () => {
      const { readdirSync } = await import("fs");
      vi.mocked(readdirSync).mockReturnValue([
        "Dockerfile",
        "docker-compose.yml",
        ".dockerignore",
        "package.json",
      ] as unknown as string[]);

      const result = findDockerFiles("/test/project");

      expect(result).toContain("Dockerfile");
      expect(result).toContain("docker-compose.yml");
      expect(result).toContain(".dockerignore");
    });

    it("should exclude non-Docker files", async () => {
      const { readdirSync } = await import("fs");
      vi.mocked(readdirSync).mockReturnValue([
        "package.json",
        ".gitignore",
        "README.md",
      ] as unknown as string[]);

      const result = findDockerFiles("/test/project");

      expect(result).toHaveLength(0);
    });

    it("should handle read errors gracefully", async () => {
      const { readdirSync } = await import("fs");
      vi.mocked(readdirSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = findDockerFiles("/test/project");

      expect(result).toHaveLength(0);
    });
  });

  describe("isContainerized()", () => {
    it("should return true when Dockerfile exists", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("Dockerfile");
      });
      vi.mocked(readFileSync).mockReturnValue("FROM node:20-alpine");

      const result = isContainerized("/test/project");

      expect(result).toBe(true);
    });

    it("should return true when docker-compose exists", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("docker-compose");
      });
      vi.mocked(readFileSync).mockReturnValue("");

      const result = isContainerized("/test/project");

      expect(result).toBe(true);
    });

    it("should return false when no Docker files exist", async () => {
      const { existsSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(false);

      const result = isContainerized("/test/project");

      expect(result).toBe(false);
    });
  });

  describe("getDockerFilePaths()", () => {
    it("should return paths to Docker files", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return (
          pathStr.includes("Dockerfile") ||
          pathStr.includes("docker-compose") ||
          pathStr.includes(".dockerignore")
        );
      });
      vi.mocked(readFileSync).mockReturnValue("");

      const result = getDockerFilePaths("/test/project");

      expect(result.dockerfiles.length).toBeGreaterThan(0);
      expect(result.dockerignore).toBeDefined();
    });

    it("should return undefined for missing .dockerignore", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return (
          String(path).includes("Dockerfile") &&
          !String(path).includes(".dockerignore")
        );
      });
      vi.mocked(readFileSync).mockReturnValue("FROM node:20-alpine");

      const result = getDockerFilePaths("/test/project");

      expect(result.dockerignore).toBeUndefined();
    });
  });
});
