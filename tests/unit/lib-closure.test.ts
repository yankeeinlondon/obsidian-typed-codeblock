import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIB_ROOTS } from "../../scripts/build-config.ts";
import { collectLibClosure, libFileName } from "../../scripts/lib-closure.ts";

const fakeLibs: Record<string, string> = {
  "lib.root.d.ts": '/// <reference lib="a" />\n/// <reference lib="B.Part" />\ndeclare var root: 1;',
  "lib.a.d.ts": '/// <reference lib="b.part" />',
  "lib.b.part.d.ts": "/* no references */\n// /// <reference lib=\"ignored-not-at-line-start\" />",
};

const readFake = (fileName: string): string => {
  const libText = fakeLibs[fileName];
  if (libText === undefined) throw new Error(`unknown lib ${fileName}`);
  return libText;
};

describe("collectLibClosure", () => {
  it("follows references transitively, case-insensitively and without duplicates", () => {
    expect(collectLibClosure(["root"], readFake)).toEqual(["lib.a.d.ts", "lib.b.part.d.ts", "lib.root.d.ts"]);
  });

  it("fails on an unknown lib instead of shipping a partial closure", () => {
    expect(() => collectLibClosure(["root", "missing"], readFake)).toThrow(/unknown lib lib.missing.d.ts/);
  });

  it("produces the full closure of the advertised libs from the installed TypeScript", () => {
    const typescriptLibDir = dirname(createRequire(import.meta.url).resolve("typescript/lib/lib.d.ts"));
    const closure = collectLibClosure(LIB_ROOTS, (fileName) => readFileSync(join(typescriptLibDir, fileName), "utf8"));
    for (const expectedLib of ["es5", "es2015.core", "es2022", "es2024", "dom", "decorators"]) {
      expect(closure).toContain(libFileName(expectedLib));
    }
    // webworker/scripthost are not advertised and must not leak into the bundle.
    expect(closure.some((fileName) => fileName.startsWith("lib.webworker"))).toBe(false);
    expect(closure).not.toContain("lib.scripthost.d.ts");
  });
});
