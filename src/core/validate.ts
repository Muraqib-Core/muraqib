import * as logger from "../shared/logger.js";
// chalk is loaded dynamically; null means "unavailable", undefined means "not yet tried"
type ChalkLike = { red: { bold: (s: string) => string } };
let chalkInstance: ChalkLike | null | undefined = undefined;

async function getChalk(): Promise<ChalkLike | null> {
  if (chalkInstance === undefined) {
    try {
      const module = await import('chalk');
      chalkInstance = module.default;
    } catch {
      chalkInstance = null;
    }
  }
  return chalkInstance;
}

/**
 * Create muraqib env.
 *
 * @param rawEnv - Raw env
 * @returns Create muraqib env result
 */
export async function createMuraqibEnv(rawEnv: Record<string, string | undefined>): Promise<Record<string, string>> {
  const sanitizedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawEnv)) { 
    if (value !== undefined) {
      let cleanValue = value.trim();
      if (cleanValue.startsWith('"') && cleanValue.endsWith('"')) {
        cleanValue = cleanValue.slice(1, -1).trim();
      }
      sanitizedEnv[key] = cleanValue;
    }
  }

  for (const key of Object.keys(sanitizedEnv)) {
    if (key.startsWith('NEXT_PUBLIC_')) {
      const chalk = await getChalk(); 
      const errorMessage = `[Muraqib Security Exception]: The server-side variable '${key}' cannot contain client-side prefixes!`;
      if (chalk) {
        logger.error(chalk.red.bold(errorMessage));
      } else {
        logger.error(errorMessage);
      }
      throw new Error(errorMessage);
    }
  }

  return sanitizedEnv;
}