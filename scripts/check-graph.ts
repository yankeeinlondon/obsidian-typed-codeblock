/**
 * `pnpm check:graph`: fails (exit 1) if the built root entry includes run-only code (Sucrase,
 * the syntax-gate parser, `src/run`) or if `/run` includes TypeScript, the worker, CM6, Lezer or
 * Obsidian. Requires a prior `pnpm build`.
 */
import { existsSync, readFileSync } from "node:fs";
import { DIST_DIR, WORKER_META_FILE } from "./build-config.ts";
import { checkGraph, type GraphMetafile } from "./graph-rules.ts";

const readMetafile = (path: string): GraphMetafile => {
  if (!existsSync(path)) {
    console.error(`check:graph: missing ${path}; run \`pnpm build\` first`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8")) as GraphMetafile;
};

const packageMetafiles = ["esm", "cjs"].map((format) => readMetafile(`${DIST_DIR}/metafile-${format}.json`));
const violations = checkGraph(packageMetafiles, readMetafile(WORKER_META_FILE));

if (violations.length > 0) {
  console.error(`check:graph: ${violations.length} boundary violation(s)`);
  for (const violation of violations) console.error(`  ${violation.output}: ${violation.module} — ${violation.rule}`);
  process.exit(1);
}
console.log("check:graph: root and /run dependency boundaries OK");
