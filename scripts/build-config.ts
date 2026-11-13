/**
 * Shared build constants: entry points, host-provided externals and output locations.
 */

/**
 * Host-provided packages kept external (spec §7.4), following the official Obsidian sample
 * plugin's explicit list, restricted to the modules this library actually uses. Deliberately
 * NOT a wildcard: `@lezer/javascript` must stay bundled because Obsidian does not expose it.
 */
export const HOST_EXTERNALS = [
  "obsidian",
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
  "@codemirror/autocomplete",
  "@codemirror/lint",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
] as const;

/** Advertised `libs` option values and the TypeScript lib roots each requires. */
export const LIB_ROOTS = [
  "es2022",
  "es2023",
  "es2024",
  "dom",
  "dom.iterable",
  "dom.asynciterable",
] as const;

export const WORKER_ENTRY = "src/worker/entry.ts";
export const WORKER_OUT_DIR = "build/worker";
export const WORKER_OUT_FILE = `${WORKER_OUT_DIR}/worker.js`;
export const WORKER_META_FILE = `${WORKER_OUT_DIR}/meta.json`;

export const PACKAGE_ENTRIES = {
  index: "src/index.ts",
  run: "src/run/index.ts",
} as const;

export const DIST_DIR = "dist";

export const WORKER_SOURCE_MODULE = "virtual:typed-codeblocks-worker";
export const LIB_FILES_MODULE = "virtual:typed-codeblocks-libs";
