/**
 * obsidian-typed-codeblocks/run: execution helper entry (spec §5.9).
 *
 * Phase 1 scaffold: shared public types only. `compileBlock` / `runBlock` arrive in Phase 7.
 * This entry must never import TypeScript, the worker, CodeMirror or Obsidian
 * (enforced by `pnpm check:graph`).
 */
export type { BlockLanguage, BlockWrap, CompileBlockOptions, RunBlockOptions } from "../shared/types.ts";
