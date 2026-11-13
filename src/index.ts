/**
 * obsidian-typed-codeblocks: root entry.
 *
 * Phase 1 scaffold: public types plus the Blob-worker primitive that the build pipeline and
 * spike S1 exercise. `typedCodeBlocks()` arrives with the CM6 integration (Phase 5).
 */
export type {
  BlockLanguage,
  BlockLib,
  BlockWrap,
  CompilerOptionsSubset,
  TypedCodeBlocksFeatures,
  TypedCodeBlocksOptions,
} from "./shared/types.ts";

export { createBlobWorker } from "./worker/spawn.ts";
export type { BlobWorkerEnvironment, BlobWorkerHandle } from "./worker/spawn.ts";
