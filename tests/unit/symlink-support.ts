import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Whether this machine may create symlinks (Windows needs Developer Mode or an elevated shell). */
function detectSymlinkSupport(): boolean {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-symlink-probe-"));
  try {
    fs.writeFileSync(path.join(dir, "target"), "x");
    fs.symlinkSync(path.join(dir, "target"), path.join(dir, "link"));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const canSymlink: boolean = detectSymlinkSupport();
