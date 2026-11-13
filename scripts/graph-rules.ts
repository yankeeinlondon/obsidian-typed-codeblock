/**
 * Dependency-graph boundary rules (spec FR-28, §7.4), evaluated over esbuild metafiles.
 *
 * Pure: takes parsed metafiles and returns violations, so the rules are unit-testable with
 * synthetic graphs (`tests/unit/graph-rules.test.ts`). `scripts/check-graph.ts` applies them to
 * the real `dist/` and `build/worker/` output.
 */

/** The subset of an esbuild metafile the rules read. */
export interface GraphMetafile {
  inputs: Record<string, unknown>;
  outputs: Record<
    string,
    {
      inputs: Record<string, unknown>;
      imports?: Array<{ path: string; kind?: string; external?: boolean }>;
      entryPoint?: string;
    }
  >;
}

export interface GraphViolation {
  /** Output file (or `worker`) the violation was found in. */
  output: string;
  /** Offending module input path or external import specifier. */
  module: string;
  rule: string;
}

interface ForbiddenModule {
  rule: string;
  test: (modulePath: string) => boolean;
}

const packagePathPattern = (packageName: string): RegExp =>
  new RegExp(`(^|/)node_modules/(\\.pnpm/[^/]+/node_modules/)?${packageName.replace("/", "\\/")}(/|$)`);

const isPackage = (packageName: string) => {
  const pattern = packagePathPattern(packageName);
  return (modulePath: string): boolean => modulePath === packageName || modulePath.startsWith(`${packageName}/`) || pattern.test(modulePath);
};

/** Modules the root entry (and the worker string it inlines) must never contain. */
export const ROOT_FORBIDDEN: readonly ForbiddenModule[] = [
  { rule: "root must not bundle the Sucrase type stripper", test: isPackage("sucrase") },
  { rule: "root must not bundle the /run syntax-gate parser", test: isPackage("@babel/parser") },
  { rule: "root must not bundle run-only code", test: (modulePath) => /(^|\/)src\/run\//.test(modulePath) },
];

const editorPackages = [
  "obsidian",
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
  "@codemirror/autocomplete",
  "@codemirror/lint",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  "@lezer/javascript",
];

/** Modules the `/run` entry must never contain or import. */
export const RUN_FORBIDDEN: readonly ForbiddenModule[] = [
  { rule: "/run must not bundle TypeScript", test: isPackage("typescript") },
  { rule: "/run must not bundle @typescript/vfs", test: isPackage("@typescript/vfs") },
  {
    rule: "/run must not include the worker string or worker code",
    test: (modulePath) => modulePath.includes("virtual:typed-codeblocks-worker") || /(^|\/)src\/worker\//.test(modulePath),
  },
  {
    rule: "/run must not include editor-only code",
    test: (modulePath) => /(^|\/)src\/(cm|highlight|registry|scanner|mapping)\//.test(modulePath),
  },
  ...editorPackages.map((packageName) => ({
    rule: `/run must not import or bundle ${packageName}`,
    test: isPackage(packageName),
  })),
];

const outputKind = (outputPath: string): "root" | "run" | undefined => {
  const fileName = outputPath.split("/").pop() ?? "";
  if (/^index\.(c?js|mjs)$/.test(fileName)) return "root";
  if (/^run\.(c?js|mjs)$/.test(fileName)) return "run";
  return undefined;
};

/** Every module an output depends on: bundled inputs plus (external) imports. */
const modulesOf = (output: GraphMetafile["outputs"][string]): string[] => [
  ...Object.keys(output.inputs),
  ...(output.imports ?? []).map((importRecord) => importRecord.path),
];

/**
 * Checks package metafiles (one per format) plus the worker metafile.
 *
 * The worker's own inputs count as part of the root, because the root inlines the worker
 * string. Throws if no root or `/run` output is present, so a renamed output cannot make the
 * check vacuously pass.
 */
export function checkGraph(packageMetafiles: readonly GraphMetafile[], workerMetafile: GraphMetafile): GraphViolation[] {
  const violations: GraphViolation[] = [];
  const seenKinds = new Set<string>();
  for (const metafile of packageMetafiles) {
    for (const [outputPath, output] of Object.entries(metafile.outputs)) {
      const kind = outputKind(outputPath);
      if (kind === undefined) continue;
      seenKinds.add(kind);
      const forbidden = kind === "root" ? ROOT_FORBIDDEN : RUN_FORBIDDEN;
      for (const modulePath of modulesOf(output)) {
        for (const forbiddenModule of forbidden) {
          if (forbiddenModule.test(modulePath)) violations.push({ output: outputPath, module: modulePath, rule: forbiddenModule.rule });
        }
      }
    }
  }
  for (const requiredKind of ["root", "run"]) {
    if (!seenKinds.has(requiredKind)) throw new Error(`graph check: no ${requiredKind} entry output found in package metafiles`);
  }
  const workerInputs = Object.keys(workerMetafile.inputs);
  if (workerInputs.length === 0) throw new Error("graph check: worker metafile has no inputs");
  for (const modulePath of workerInputs) {
    for (const forbiddenModule of ROOT_FORBIDDEN) {
      if (forbiddenModule.test(modulePath)) violations.push({ output: "worker", module: modulePath, rule: forbiddenModule.rule });
    }
  }
  return violations;
}
