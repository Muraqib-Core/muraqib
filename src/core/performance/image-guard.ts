import fs from 'fs';
import path from 'path';
import { BaseGuard } from '../base-guard.js';
import type { AuditResult, AuditIssue, AuditContext } from '../types.js';

const MAX_IMAGE_SIZE_BYTES = 500 * 1024;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'out',
]);

export interface ImageViolation {
  filePath: string;
  sizeKB: number;
  recommendation: string;
}

export interface ImageAuditResult {
  violations: ImageViolation[];
}

const scanDirectoryForImages = (
  dirPath: string,
  violations: ImageViolation[] = []
): ImageViolation[] => {
  if (SKIP_DIR_NAMES.has(path.basename(dirPath))) {
    return violations;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return violations;
  }

  for (const file of entries) {
    const fullPath = path.join(dirPath, file);

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) {
      continue;
    }

    if (stat.isDirectory()) {
      scanDirectoryForImages(fullPath, violations);
    } else if (stat.isFile()) {
      const ext = path.extname(fullPath).toLowerCase();
      if (IMAGE_EXTENSIONS.includes(ext)) {
        if (stat.size > MAX_IMAGE_SIZE_BYTES) {
          const sizeKB = Math.round(stat.size / 1024);
          violations.push({
            filePath: path.relative(process.cwd(), fullPath),
            sizeKB,
            recommendation: `Convert this image to '.webp' or compress it. WebP can reduce size up to 75%.`,
          });
        }
      }
    }
  }

  return violations;
};

function performImageAuditInternal(targetPath?: string): ImageAuditResult {
  const rootDir = targetPath ?? process.cwd();
  return { violations: scanDirectoryForImages(rootDir) };
}

export { performImageAuditInternal as runImagePerformanceAudit };

export class ImageGuard extends BaseGuard {
  private targetPath?: string;

  constructor(targetPath?: string, context?: AuditContext) {
    super('image-guard', context);
    this.targetPath = targetPath;
  }

  async execute(): Promise<AuditResult> {
    const result = performImageAuditInternal(this.targetPath);
    const issues: AuditIssue[] = [];

    for (const violation of result.violations) {
      issues.push(
        this.createIssue(
          'IMAGE_SIZE_EXCEEDED',
          'warning',
          'Large Image Detected',
          `Image '${violation.filePath}' is ${violation.sizeKB}KB (exceeds 500KB limit)`,
          { file: violation.filePath },
          violation.recommendation,
          ['performance', 'image']
        )
      );
    }

    const status = result.violations.length === 0 ? 'ok' : 'warning';
    return this.createResult(
      status,
      issues,
      status === 'ok'
        ? '✅ All images optimized (< 500KB)'
        : `⚠️ ${result.violations.length} image(s) exceed size limit`
    );
  }
}
