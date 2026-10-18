import fs from "node:fs";

/**
 * Lists a directory with entry types; an unreadable or missing directory counts as empty so one
 * bad folder never aborts a whole audit.
 *
 * @param dir - Directory to list
 * @returns The directory entries, or an empty array when it cannot be read
 */
export function readDirEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Reads and parses a JSON file without throwing.
 *
 * @param file - Path of the JSON file
 * @returns The parsed value, or undefined when the file is missing, unreadable or not valid JSON
 */
export function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return undefined;
  }
}
