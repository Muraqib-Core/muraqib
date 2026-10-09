// ANSI Color codes
export const COLORS = {
  RESET: "\x1b[0m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  CYAN: "\x1b[36m",
  DIM: "\x1b[2m",
  BOLD: "\x1b[1m",
} as const;

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
