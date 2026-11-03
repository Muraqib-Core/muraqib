import { EnvExampleFixer } from "./fixers/env-example.js";
import { FloatingPromiseFixer } from "./fixers/floating-promise.js";
import { SecretsToEnvFixer } from "./fixers/secrets-to-env.js";
import type { Fixer } from "./types.js";

/** Fixers used by `muraqib-agent fix`. Each fixer module adds itself here. */
export const DEFAULT_FIXERS: readonly Fixer[] = [new FloatingPromiseFixer(), new SecretsToEnvFixer(), new EnvExampleFixer()];
