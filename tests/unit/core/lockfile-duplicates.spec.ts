import { describe, expect, it } from "vitest";
import {
  collectNpmLockVersions,
  collectPnpmLockVersions,
  collectYarnLockVersions,
  findDuplicateVersions,
  type PackageVersions,
} from "../../../src/core/helpers/lockfile-duplicates.js";

function collect(
  collector: (content: string, into: PackageVersions) => void,
  content: string,
): Record<string, string[]> {
  const into: PackageVersions = new Map();
  collector(content, into);
  return Object.fromEntries([...into].map(([name, set]) => [name, [...set].sort()]));
}

describe("collectNpmLockVersions", () => {
  it("ignores unparsable and non-object content", () => {
    for (const content of ["{ nope", "[]", "null", "42", "{}"]) {
      expect(collect(collectNpmLockVersions, content)).toEqual({});
    }
  });

  it("reads lockfileVersion 2/3 packages, deriving names from the last node_modules segment", () => {
    const lock = {
      packages: {
        "": { name: "root", version: "1.0.0" },
        "node_modules/a": { version: "1.0.0" },
        "node_modules/a/node_modules/b": { version: "2.0.0" },
        "node_modules/@scope/c": { version: "3.0.0" },
        "node_modules/x": { name: "real-name", version: "4.0.0" },
        "node_modules/linked": { link: true, version: "9.9.9" },
        "node_modules/no-version": {},
        "node_modules/bad-entry": "string",
        "packages/workspace": { version: "1.0.0" },
        "node_modules/d": { version: "" },
      },
    };
    expect(collect(collectNpmLockVersions, JSON.stringify(lock))).toEqual({
      a: ["1.0.0"],
      b: ["2.0.0"],
      "@scope/c": ["3.0.0"],
      "real-name": ["4.0.0"],
    });
  });

  it("reads lockfileVersion 1 nested dependencies and skips non-registry versions", () => {
    const lock = {
      dependencies: {
        a: { version: "1.0.0", dependencies: { b: { version: "2.0.0" }, bad: "string" } },
        local: { version: "file:../local" },
        linked: { version: "link:../x" },
        git: { version: "git+https://example.com/x.git" },
        gitSsh: { version: "git+ssh://git@example.com/x.git#abc" },
        gh: { version: "github:user/repo" },
        web: { version: "https://example.com/x.tgz" },
        noVersion: { dependencies: { c: { version: "3.0.0" } } },
        notRecord: ["x"],
      },
    };
    expect(collect(collectNpmLockVersions, JSON.stringify(lock))).toEqual({
      a: ["1.0.0"],
      b: ["2.0.0"],
      c: ["3.0.0"],
    });
  });

  it("tolerates a missing or malformed dependencies field", () => {
    expect(collect(collectNpmLockVersions, JSON.stringify({ dependencies: "x" }))).toEqual({});
    expect(collect(collectNpmLockVersions, JSON.stringify({ lockfileVersion: 1 }))).toEqual({});
  });

  it("merges versions into an existing map", () => {
    const into: PackageVersions = new Map([["a", new Set(["0.9.0"])]]);
    collectNpmLockVersions(JSON.stringify({ packages: { "node_modules/a": { version: "1.0.0" } } }), into);
    expect([...(into.get("a") ?? [])].sort()).toEqual(["0.9.0", "1.0.0"]);
  });
});

describe("collectYarnLockVersions", () => {
  it("reads classic v1 entries with several descriptors per header", () => {
    const lock = [
      "# yarn lockfile v1",
      "",
      'lodash@^4.17.0, "lodash@^4.17.21":',
      '  version "4.17.21"',
      "",
      '"@scope/pkg@^1.0.0":',
      '  version "1.0.0"',
      "  dependencies:",
      '    lodash "^4.0.0"',
      "",
    ].join("\n");
    expect(collect(collectYarnLockVersions, lock)).toEqual({ lodash: ["4.17.21"], "@scope/pkg": ["1.0.0"] });
  });

  it("reads berry entries, skipping metadata and local workspaces", () => {
    const lock = [
      "__metadata:",
      "  version: 6",
      "",
      '"a@npm:^1.0.0":',
      "  version: 1.2.3",
      "  resolution: \"a@npm:1.2.3\"",
      "",
      '"workspace-pkg@workspace:.":',
      "  version: 0.0.0-use.local",
      "",
      "not-a-header",
      "  version: 9.9.9",
      "",
      "orphan:",
      "  resolution: nothing",
      "  version: '2.0.0'",
    ].join("\r\n");
    expect(collect(collectYarnLockVersions, lock)).toEqual({ a: ["1.2.3"], orphan: ["2.0.0"] });
  });

  it("ignores version lines that appear before any header and resets after each version", () => {
    const lock = ["  version 1.0.0", "a@^1:", "  version 1.0.0", "  version 2.0.0"].join("\n");
    expect(collect(collectYarnLockVersions, lock)).toEqual({ a: ["1.0.0"] });
  });

  it("falls back to the whole descriptor when it has no version separator", () => {
    expect(collect(collectYarnLockVersions, 'plain:\n  version "1.0.0"\n')).toEqual({ plain: ["1.0.0"] });
  });
});

describe("collectPnpmLockVersions", () => {
  it("reads the packages section across key styles", () => {
    const lock = [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "      ignored: 1.0.0",
      "packages:",
      "  /lodash@4.17.21:",
      "    resolution: {}",
      "  /legacy/1.2.3:",
      "    dev: false",
      "  /@scope/legacy/2.0.0_react@18.0.0:",
      "    dev: false",
      "  'react@18.2.0(prop-types@15.8.1)':",
      "    resolution: {}",
      '  "@scope/modern@3.0.0":',
      "    resolution: {}",
      "  plain@1.0.0: {}",
      "  '@types/3d-lib@1.0.0':",
      "    resolution: {}",
      "  no-version-key:",
      "    x: 1",
      "snapshots:",
      "  after@9.9.9:",
      "    x: 1",
    ].join("\n");
    expect(collect(collectPnpmLockVersions, lock)).toEqual({
      lodash: ["4.17.21"],
      legacy: ["1.2.3"],
      "@scope/legacy": ["2.0.0"],
      react: ["18.2.0"],
      "@scope/modern": ["3.0.0"],
      plain: ["1.0.0"],
      "@types/3d-lib": ["1.0.0"],
    });
  });

  it("ignores content without a packages section", () => {
    expect(collect(collectPnpmLockVersions, "importers:\n  a@1.0.0:\n    x: 1\n")).toEqual({});
    expect(collect(collectPnpmLockVersions, "")).toEqual({});
  });
});

describe("findDuplicateVersions", () => {
  it("returns only multi-version packages, sorted by name with numerically sorted versions", () => {
    const versions: PackageVersions = new Map([
      ["zed", new Set(["1.0.0", "1.0.0-beta"])],
      ["alpha", new Set(["1.10.0", "1.2.0", "1.9.1"])],
      ["single", new Set(["1.0.0"])],
    ]);
    expect(findDuplicateVersions(versions)).toEqual([
      { name: "alpha", versions: ["1.2.0", "1.9.1", "1.10.0"] },
      { name: "zed", versions: ["1.0.0", "1.0.0-beta"] },
    ]);
  });

  it("returns an empty list for no duplicates", () => {
    expect(findDuplicateVersions(new Map())).toEqual([]);
  });
});
