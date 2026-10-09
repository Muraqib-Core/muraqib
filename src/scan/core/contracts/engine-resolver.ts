import type { ValidationEngine } from "./validation-engine.js";

export interface ValidationEngineResolver {
  resolve(): ValidationEngine;
}
