/**
 * Public, dependency-free API types shared by the root entry and `obsidian-typed-codeblocks/run`.
 *
 * These mirror spec §6. Nothing here imports TypeScript, CodeMirror or Obsidian so that the
 * `/run` entry can re-export them without pulling editor packages into its graph.
 */

/** The language a fence is checked/executed as. */
export type BlockLanguage = "ts" | "js";

/** How a block's source is wrapped before checking and execution (FR-7). */
export type BlockWrap = "none" | "async-function" | { prefix: string; suffix: string };

/** Consumer-facing boolean compiler options; merged over the fixed defaults of spec §7.3. */
export interface CompilerOptionsSubset {
  strict?: boolean;
  noImplicitAny?: boolean;
  strictNullChecks?: boolean;
  noUncheckedIndexedAccess?: boolean;
  exactOptionalPropertyTypes?: boolean;
  noUnusedLocals?: boolean;
  noUnusedParameters?: boolean;
  skipLibCheck?: boolean;
}

/** Standard-library type sets a consumer may select. Types only, never runtime APIs. */
export type BlockLib = "es2022" | "es2023" | "es2024" | "dom";

/** Feature toggles; every flag defaults to `true`. */
export interface TypedCodeBlocksFeatures {
  completion?: boolean;
  diagnostics?: boolean;
  hover?: boolean;
  highlight?: boolean;
}

/** Options accepted by `typedCodeBlocks()` (spec §6). */
export interface TypedCodeBlocksOptions {
  /** Unique consumer id matching `[A-Za-z0-9][A-Za-z0-9_-]*`. */
  id: string;
  /** Fence info-string first word → language. */
  fences: Record<string, BlockLanguage>;
  /** Virtual absolute `.d.ts` path → declaration text. */
  globals: Record<string, string>;
  wrap?: BlockWrap;
  compilerOptions?: CompilerOptionsSubset;
  libs?: BlockLib[];
  ignoreDiagnostics?: number[];
  lintDelay?: number;
  features?: TypedCodeBlocksFeatures;
  mobile?: boolean;
  onError?: (error: unknown) => void;
}

/** Options for `compileBlock()` from `obsidian-typed-codeblocks/run`. */
export interface CompileBlockOptions {
  lang: BlockLanguage;
  wrap?: BlockWrap;
}

/** Options for `runBlock()` from `obsidian-typed-codeblocks/run`. */
export interface RunBlockOptions extends CompileBlockOptions {
  globals?: Record<string, unknown>;
  verifyGlobals?: string | Record<string, string>;
}
