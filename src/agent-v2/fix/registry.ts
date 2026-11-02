import { FloatingPromiseFixer } from "./fixers/floating-promise.js";
import type { Fixer } from "./types.js";

/** Fixers used by `muraqib-agent fix`. Each fixer module adds itself here. */
export const DEFAULT_FIXERS: readonly Fixer[] = [new FloatingPromiseFixer()];
