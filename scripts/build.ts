/**
 * Two-stage build (plan ruling 1).
 *
 * Stage 1 bundles `src/worker/entry.ts` (TypeScript, @typescript/vfs and the transitive
 * standard-library closure) into one self-contained IIFE script at `build/worker/worker.js`.
 * Stage 2 runs tsup for the root and `/run` entries (ESM + CJS + d.ts). The virtual module
 * `virtual:typed-codeblocks-worker` is resolved to the stage-1 output *as a string*, so the
 * worker ships inside `dist/index.*` without any `?raw` import or loader on the consumer side.
 *
 * Usage: `node scripts/build.ts [--worker-only]`
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build as esbuild, type Plugin } from "esbuild";
import { build as tsupBuild } from "tsup";
import {
  DIST_DIR,
  HOST_EXTERNALS,
  LIB_FILES_MODULE,
  LIB_ROOTS,
  PACKAGE_ENTRIES,
  WORKER_ENTRY,
  WORKER_META_FILE,
  WORKER_OUT_DIR,
  WORKER_OUT_FILE,
  WORKER_SOURCE_MODULE,
} from "./build-config.ts";
import { collectLibClosure } from "./lib-closure.ts";

const requireFromHere = createRequire(import.meta.url);
const typescriptLibDir = dirname(requireFromHere.resolve("typescript/lib/lib.d.ts"));

/** Serves the standard-library `.d.ts` closure as a `{ "/lib.x.d.ts": text }` module. */
function libFilesPlugin(): Plugin {
  return {
    name: "typed-codeblocks-lib-files",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^virtual:typed-codeblocks-libs$/ }, () => ({
        path: LIB_FILES_MODULE,
        namespace: "typed-codeblocks-libs",
      }));
      pluginBuild.onLoad({ filter: /.*/, namespace: "typed-codeblocks-libs" }, () => {
        const libFileNames = collectLibClosure(LIB_ROOTS, (fileName) =>
          readFileSync(join(typescriptLibDir, fileName), "utf8"),
        );
        const libMap: Record<string, string> = {};
        for (const fileName of libFileNames) {
          libMap[`/${fileName}`] = readFileSync(join(typescriptLibDir, fileName), "utf8");
        }
        return { contents: `export default ${JSON.stringify(libMap)};`, loader: "js" };
      });
    },
  };
}

/**
 * Replaces Node built-ins with empty modules. TypeScript and @typescript/vfs only touch them on
 * Node-only code paths; the worker must never `require` them at runtime (spec §7.4).
 */
function emptyNodeBuiltinsPlugin(): Plugin {
  const builtinNames = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  return {
    name: "typed-codeblocks-empty-node-builtins",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /.*/ }, (args) =>
        builtinNames.has(args.path) ? { path: args.path, namespace: "empty-node-builtin" } : undefined,
      );
      pluginBuild.onLoad({ filter: /.*/, namespace: "empty-node-builtin" }, () => ({
        contents: "module.exports = {};",
        loader: "js",
      }));
    },
  };
}

/** Resolves `virtual:typed-codeblocks-worker` to the stage-1 output as a string module. */
function workerSourcePlugin(): Plugin {
  return {
    name: "typed-codeblocks-worker-source",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^virtual:typed-codeblocks-worker$/ }, () => ({
        path: WORKER_SOURCE_MODULE,
        namespace: "typed-codeblocks-worker",
      }));
      pluginBuild.onLoad({ filter: /.*/, namespace: "typed-codeblocks-worker" }, () => ({
        contents: readFileSync(WORKER_OUT_FILE, "utf8"),
        loader: "text",
      }));
    },
  };
}

export async function buildWorker(): Promise<void> {
  rmSync(WORKER_OUT_DIR, { recursive: true, force: true });
  mkdirSync(WORKER_OUT_DIR, { recursive: true });
  const workerResult = await esbuild({
    entryPoints: [WORKER_ENTRY],
    outfile: WORKER_OUT_FILE,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "inline",
    metafile: true,
    logLevel: "warning",
    // Spike S1: Obsidian desktop workers expose Node globals (`process`, `require`, `module`).
    // TypeScript's `isNodeLikeSystem()` then selects its Node `sys` and calls into `os`/`fs`.
    // Compiling every `process` reference to `undefined` keeps TypeScript (and `debug`) on the
    // browser code path on every host, matching mobile and plain browsers.
    define: { process: "undefined" },
    plugins: [libFilesPlugin(), emptyNodeBuiltinsPlugin()],
  });
  writeFileSync(WORKER_META_FILE, JSON.stringify(workerResult.metafile, null, 2));
}

export async function buildPackage(): Promise<void> {
  rmSync(DIST_DIR, { recursive: true, force: true });
  await tsupBuild({
    entry: PACKAGE_ENTRIES,
    outDir: DIST_DIR,
    format: ["esm", "cjs"],
    dts: true,
    target: "es2022",
    platform: "neutral",
    splitting: false,
    sourcemap: false,
    clean: false,
    metafile: true,
    treeshake: true,
    external: [...HOST_EXTERNALS],
    esbuildPlugins: [workerSourcePlugin()],
    silent: true,
  });
}

const workerOnly = process.argv.includes("--worker-only");
await buildWorker();
if (!workerOnly) await buildPackage();
