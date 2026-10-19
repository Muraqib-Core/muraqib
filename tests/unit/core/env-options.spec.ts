import { describe, expect, it } from "vitest";
import { getMuraqibEnvMap, getSensitiveMuraqibEnvKeys } from "../../../src/core/env-options.js";

describe("env-options", () => {
  it("maps option names to MURAQIB_ upper-snake env keys", () => {
    const map = getMuraqibEnvMap();
    expect(map["MURAQIB_DB_URL"]).toEqual({ configName: "dbUrl", type: "string", isSensitive: true });
    expect(map["MURAQIB_ALLOW_EMPTY"]).toEqual({ configName: "allowEmpty", type: "boolean", isSensitive: false });
    expect(map["MURAQIB_SERVER_PORT"]).toEqual({ configName: "serverPort", type: "number", isSensitive: false });
  });

  it("returns a fresh map on every call", () => {
    expect(getMuraqibEnvMap()).not.toBe(getMuraqibEnvMap());
  });

  it("lists only sensitive keys", () => {
    expect(getSensitiveMuraqibEnvKeys()).toEqual(["MURAQIB_DB_URL"]);
  });
});
