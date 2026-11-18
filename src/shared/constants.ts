const ANSI_CODES = {
  RESET: "\x1b[0m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  CYAN: "\x1b[36m",
  DIM: "\x1b[2m",
  BOLD: "\x1b[1m",
} as const;

/** https://no-color.org: any non-empty NO_COLOR value turns colored output off. */
const colorDisabled = (process.env.NO_COLOR ?? "") !== "";

// ANSI Color codes (empty strings when NO_COLOR is set)
export const COLORS: Readonly<Record<keyof typeof ANSI_CODES, string>> = colorDisabled
  ? { RESET: "", RED: "", GREEN: "", YELLOW: "", CYAN: "", DIM: "", BOLD: "" }
  : ANSI_CODES;

// CLI flags
export const CLI_FLAGS = {
  SKIP_ENV: "--skip-env",
  SKIP_NETWORK: "--skip-network",
  SKIP_MEMORY: "--skip-memory",
  SKIP_SECURITY: "--skip-security",
  SKIP_DEAD_CODE: "--skip-dead-code",
  SKIP_DEPENDENCIES: "--skip-dependencies",
  SKIP_ASYNC: "--skip-async",
  SKIP_CONFIG: "--skip-config",
  SKIP_PERFORMANCE: "--skip-performance",
  SKIP_OPTIMIZER: "--skip-optimizer",
  SKIP_RENDER_BLOCKING: "--skip-render-blocking",
  SILENT: "--silent",
  SAFE: "--safe",
  UPGRADE: "--upgrade",
  PATH: "--path",
  URL: "--url",
  SECURITY_URL: "--security-url",
  SCHEDULE: "--schedule",
  PRESETS: "--presets",
} as const;

/** Dependency install folder, never part of the audited source. */
export const DEPENDENCY_DIR = "node_modules";

/** Version-control metadata folder. */
export const VCS_DIR = ".git";

/** Folders that hold build output or coverage reports rather than authored source. */
export const BUILD_OUTPUT_DIRS: readonly string[] = ["dist", "build", "out", "coverage", ".next", ".nuxt"];

/** Folder names (matched against a single path segment) that directory walkers never descend into. */
export const SKIPPED_DIR_NAMES: ReadonlySet<string> = new Set([DEPENDENCY_DIR, VCS_DIR, ...BUILD_OUTPUT_DIRS]);

/** Folders excluded from source discovery by glob (any depth); kept narrow so authored `build/` or `out/` modules stay audited. */
export const SOURCE_SCAN_IGNORED_DIRS: readonly string[] = [DEPENDENCY_DIR, "dist", "coverage"];
