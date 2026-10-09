import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DockerEngine, performDockerScan } from "../../../../src/scanners/docker/docker-engine.js";

vi.mock("fs");

describe("DockerEngine", () => {
  let engine: DockerEngine;

  beforeEach(() => {
    engine = new DockerEngine({
      projectRoot: "/mock/project",
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("execute()", () => {
    it("should return ok when no Dockerfile found", async () => {
      const { existsSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await engine.execute();

      expect(result.status).toBe("ok");
      expect(result.message).toContain("No Dockerfile");
    });

    it("should detect unpinned base image", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("Dockerfile");
      });
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:latest\nRUN npm install"
      );

      const result = await engine.execute();

      expect(result.status).toBe("issues");
      expect(result.issues.length).toBeGreaterThan(0);
      expect(
        result.issues.some((i) => i.code === "DOCKER_UNPINNED_BASE_IMAGE")
      ).toBe(true);
    });

    it("should detect large base image", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("Dockerfile");
      });
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20.10.0\nRUN useradd -m appuser\nUSER appuser\nHEALTHCHECK --interval=30s CMD echo ok"
      );

      const result = await engine.execute();

      expect(result.status).toBe("warning");
      expect(
        result.issues.some((i) => i.code === "DOCKER_LARGE_BASE_IMAGE")
      ).toBe(true);
    });

    it("should detect root user", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("Dockerfile");
      });
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20-alpine\nUSER root\nRUN npm install"
      );

      const result = await engine.execute();

      expect(result.status).toBe("error");
      expect(
        result.issues.some((i) => i.code === "DOCKER_ROOT_USER")
      ).toBe(true);
    });

    it("should detect hardcoded secrets", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("Dockerfile");
      });
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20-alpine\nENV API_KEY=sk-1234567890\nRUN npm install"
      );

      const result = await engine.execute();

      expect(result.status).toBe("error");
      expect(
        result.issues.some((i) => i.code === "DOCKER_HARDCODED_SECRETS")
      ).toBe(true);
    });

    it("should detect missing HEALTHCHECK", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("Dockerfile");
      });
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20-alpine\nUSER appuser\nRUN npm install"
      );

      const result = await engine.execute();

      expect(
        result.issues.some((i) => i.code === "DOCKER_NO_HEALTHCHECK")
      ).toBe(true);
    });

    it("should detect missing non-root user", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("Dockerfile");
      });
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20-alpine\nRUN npm install\nCMD npm start"
      );

      const result = await engine.execute();

      expect(
        result.issues.some((i) => i.code === "DOCKER_NO_NON_ROOT_USER")
      ).toBe(true);
    });

    it("should detect apt-get cache not cleaned", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("Dockerfile");
      });
      vi.mocked(readFileSync).mockReturnValue(
        "FROM ubuntu:22.04\nRUN apt-get update && apt-get install -y curl"
      );

      const result = await engine.execute();

      expect(
        result.issues.some((i) => i.code === "DOCKER_APT_CACHE_NOT_CLEANED")
      ).toBe(true);
    });

    it("should detect missing .dockerignore", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        if (String(path).includes(".dockerignore")) {
          return false;
        }
        return String(path).includes("Dockerfile");
      });
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20-alpine\nUSER appuser\nRUN npm install"
      );

      const result = await engine.execute();

      expect(
        result.issues.some((i) => i.code === "DOCKER_MISSING_DOCKERIGNORE")
      ).toBe(true);
    });

    it("should pass when Dockerfile follows best practices", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("Dockerfile") ||
          String(path).includes(".dockerignore")
          ? true
          : false;
      });
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (String(path).includes(".dockerignore")) {
          return "node_modules\n.git\n.env\ndist";
        }
        return `FROM node:20-alpine
RUN useradd -m appuser
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
USER appuser
HEALTHCHECK --interval=30s CMD node /healthcheck.js
CMD npm start`;
      });

      const result = await engine.execute();

      expect(result.status).toBe("ok");
      expect(result.issues).toHaveLength(0);
    });

    it("should detect docker-compose privilege mode", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return (
          pathStr.includes("Dockerfile") ||
          pathStr.includes("docker-compose.yml")
        );
      });
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (String(path).includes("docker-compose")) {
          return "version: '3'\nservices:\n  app:\n    image: myapp\n    privileged: true";
        }
        return "FROM node:20-alpine\nUSER appuser\nRUN npm install";
      });

      const result = await engine.execute();

      expect(
        result.issues.some((i) => i.code === "DOCKER_COMPOSE_PRIVILEGED_MODE")
      ).toBe(true);
    });

    it("should handle file read errors gracefully", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = await engine.execute();

      expect(result.status).toBe("ok");
    });
  });

  describe("performDockerScan()", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should be callable as standalone function", async () => {
      const { existsSync, readFileSync } = await import("fs");
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("Dockerfile");
      });
      vi.mocked(readFileSync).mockReturnValue(
        "FROM node:20-alpine\nRUN npm install"
      );

      const result = await performDockerScan({
        projectRoot: "/test/project",
      });

      expect(result.module).toBe("docker-security-engine");
    });
  });
});
