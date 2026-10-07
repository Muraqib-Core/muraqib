import fs from 'fs';
import path from 'path';

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
    // Unreadable directory (permissions etc.) — skip silently
    return violations;
  }

  for (const file of entries) {
    const fullPath = path.join(dirPath, file);

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(fullPath); // lstat: never follow symlinks
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) {
      continue; // skip symlinks entirely to avoid loops
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

export const runImagePerformanceAudit = (targetPath?: string): ImageAuditResult => {
  const rootDir = targetPath ?? process.cwd();
  const violations = scanDirectoryForImages(rootDir);

  console.log('\n📷 [Muraqib]: Starting Image Assets Size Audit...');

  if (violations.length > 0) {
    console.error(`\n🚨 [Muraqib Image Guard]: Found ${violations.length} unoptimized heavy images!`);
    console.log('=================================================================');
    for (const img of violations) {
      console.error(`❌ File: ${img.filePath} (${img.sizeKB} KB) -> Exceeds limit of 500 KB.`);
      console.log(`⚡ [Muraqib Suggestion]: ${img.recommendation}\n`);
    }
    console.log('=================================================================');
  } else {
    console.log('✅ [Muraqib]: All images are optimized and under the 500KB safety limit.');
  }

  return { violations };
};
