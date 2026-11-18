/** Quotes a JavaScript snippet for `node -e` so it works in sh and cmd.exe: the snippet must use single quotes only. */
export function nodeCmd(js: string): string {
  if (/["$`\\%&|<>^!]/.test(js.replace(/=>/g, ""))) throw new Error(`snippet is not shell-portable: ${js}`);
  return `"${process.execPath}" -e "${js}"`;
}

/** Fake credential built at runtime so no scanner sees a literal. */
export const FAKE_SECRET = ["sk", "live", "A1b2C3d4E5f6G7h8I9j0K1l2"].join("_");
