import { describe, expect, it } from "vitest";
import { checkGraph, type GraphMetafile } from "../../scripts/graph-rules.ts";

const pnpmPath = (packageName: string, file: string): string =>
  `node_modules/.pnpm/${packageName.replace("/", "+")}@1.0.0/node_modules/${packageName}/${file}`;

/** A clean graph shaped like the real `dist/metafile-esm.json` output. */
const cleanPackageGraph = (): GraphMetafile => ({
  inputs: {},
  outputs: {
    "dist/index.js": {
      inputs: { "src/index.ts": {}, "src/worker/spawn.ts": {}, "typed-codeblocks-worker:virtual:typed-codeblocks-worker": {} },
      imports: [{ path: "@codemirror/state", kind: "import-statement", external: true }],
    },
    "dist/run.js": {
      inputs: { "src/run/index.ts": {}, [pnpmPath("sucrase", "dist/index.js")]: {} },
      imports: [],
    },
  },
});

const cleanWorkerGraph = (): GraphMetafile => ({
  inputs: { "src/worker/entry.ts": {}, [pnpmPath("typescript", "lib/typescript.js")]: {} },
  outputs: {},
});

describe("checkGraph", () => {
  it("accepts a graph that respects both entry boundaries (control)", () => {
    expect(checkGraph([cleanPackageGraph()], cleanWorkerGraph())).toEqual([]);
  });

  it("rejects Sucrase bundled into the root entry", () => {
    const graph = cleanPackageGraph();
    graph.outputs["dist/index.js"]!.inputs[pnpmPath("sucrase", "dist/index.js")] = {};
    const violations = checkGraph([graph], cleanWorkerGraph());
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ output: "dist/index.js", rule: expect.stringContaining("Sucrase") });
  });

  it("rejects run-only source and the syntax-gate parser in the root (CJS output too)", () => {
    const graph = cleanPackageGraph();
    graph.outputs["dist/index.cjs"] = {
      inputs: { "src/run/compile.ts": {}, [pnpmPath("@babel/parser", "lib/index.js")]: {} },
    };
    const violationModules = checkGraph([graph], cleanWorkerGraph()).map((violation) => violation.module);
    expect(violationModules).toEqual(["src/run/compile.ts", pnpmPath("@babel/parser", "lib/index.js")]);
  });

  it("rejects Sucrase reaching the root through the inlined worker", () => {
    const workerGraph = cleanWorkerGraph();
    workerGraph.inputs[pnpmPath("sucrase", "dist/index.js")] = {};
    expect(checkGraph([cleanPackageGraph()], workerGraph)).toEqual([
      expect.objectContaining({ output: "worker", rule: expect.stringContaining("Sucrase") }),
    ]);
  });

  it.each([
    ["TypeScript", pnpmPath("typescript", "lib/typescript.js")],
    ["@typescript/vfs", pnpmPath("@typescript/vfs", "dist/vfs.esm.js")],
    ["worker", "typed-codeblocks-worker:virtual:typed-codeblocks-worker"],
    ["worker", "src/worker/spawn.ts"],
    ["editor-only", "src/cm/completion.ts"],
    ["@lezer/javascript", pnpmPath("@lezer/javascript", "dist/index.js")],
  ])("rejects bundled %s code in /run", (ruleFragment, modulePath) => {
    const graph = cleanPackageGraph();
    graph.outputs["dist/run.js"]!.inputs[modulePath] = {};
    expect(checkGraph([graph], cleanWorkerGraph())).toEqual([
      expect.objectContaining({ output: "dist/run.js", module: modulePath, rule: expect.stringContaining(ruleFragment) }),
    ]);
  });

  it.each(["obsidian", "@codemirror/view", "@lezer/common"])("rejects an external import of %s from /run", (specifier) => {
    const graph = cleanPackageGraph();
    graph.outputs["dist/run.cjs"] = { inputs: { "src/run/index.ts": {} }, imports: [{ path: specifier, kind: "require-call", external: true }] };
    expect(checkGraph([graph], cleanWorkerGraph())).toEqual([
      expect.objectContaining({ output: "dist/run.cjs", module: specifier }),
    ]);
  });

  it("does not confuse look-alike package names with forbidden packages", () => {
    const graph = cleanPackageGraph();
    graph.outputs["dist/run.js"]!.inputs[pnpmPath("typescript-helpers", "index.js")] = {};
    graph.outputs["dist/run.js"]!.imports = [{ path: "obsidian-utils", external: true }];
    expect(checkGraph([graph], cleanWorkerGraph())).toEqual([]);
  });

  it("throws when an entry output is missing instead of passing vacuously", () => {
    const graph = cleanPackageGraph();
    delete graph.outputs["dist/run.js"];
    expect(() => checkGraph([graph], cleanWorkerGraph())).toThrow(/no run entry output/);
    expect(() => checkGraph([cleanPackageGraph()], { inputs: {}, outputs: {} })).toThrow(/worker metafile has no inputs/);
  });
});
