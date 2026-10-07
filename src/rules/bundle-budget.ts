import fs from 'fs';
import path from 'path';
import { log, error, warn } from '../shared/logger.js';

const BUNDLE_LIMIT_KB = 14;
const SUPPORTED_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.svelte', '.vue'];
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'build', 'coverage', 'out']);

interface BundleViolation {
    filePath: string;
    sizeKB: number;
    limitKB: number;
    suggestions: string[];
}

interface BundleAuditResult {
    /** Number of source files that were actually measured. */
    scannedFiles: number;
    /** True when nothing could be measured — the caller must NOT report this as a pass. */
    skipped: boolean;
    violations: BundleViolation[];
    /** Project-level findings (e.g. minification disabled). */
    projectIssues: string[];
}

const collectSourceFiles = (dir: string, found: string[] = []): string[] => {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return found;
    }

    for (const entry of entries) {
        // Match on the entry's own name only, never on a substring of the full path.
        const name = path.basename(entry.name);
        if (name.startsWith('.') || entry.isSymbolicLink()) continue;

        const fullPath = path.join(dir, name);
        if (entry.isDirectory()) {
            if (!SKIP_DIR_NAMES.has(name)) collectSourceFiles(fullPath, found);
        } else if (entry.isFile() && SUPPORTED_EXTENSIONS.includes(path.extname(name)) && !name.endsWith('.d.ts')) {
            found.push(fullPath);
        }
    }
    return found;
};

export const runComprehensiveBundleAudit = (targetPath?: string): BundleAuditResult => {
    const projectRoot = targetPath || process.cwd();
    const violations: BundleViolation[] = [];

    console.log(`🔍 [Muraqib Engine]: Scanning workspace source files against the ${BUNDLE_LIMIT_KB}KB budget...`);
    const files = collectSourceFiles(projectRoot);

    if (files.length === 0) {
        console.warn(`⚠️ [Muraqib]: No JS/TS/Svelte/Vue source files found — bundle audit could not run.`);
        return { scannedFiles: 0, skipped: true, violations, projectIssues: [] };
    }

    for (const file of files) {
        let size: number;
        try {
            size = fs.statSync(file).size;
        } catch {
            continue;
        }
        const sizeKB = size / 1024;
        if (sizeKB <= BUNDLE_LIMIT_KB) continue;

        const filePath = path.relative(projectRoot, file);
        violations.push({ filePath, sizeKB: Number(sizeKB.toFixed(2)), limitKB: BUNDLE_LIMIT_KB, suggestions: [] });

        error(`❌ [Budget Violation]: ${filePath} is ${sizeKB.toFixed(2)}KB (limit ${BUNDLE_LIMIT_KB}KB).`);
    }

    const projectIssues: string[] = [];
    projectIssues.forEach(msg => warn(msg));

    if (violations.length === 0 && projectIssues.length === 0) {
        log(`✅ [Muraqib]: All ${files.length} source file(s) are within the ${BUNDLE_LIMIT_KB}KB budget.`);
    }

    return { scannedFiles: files.length, skipped: false, violations, projectIssues };
};
