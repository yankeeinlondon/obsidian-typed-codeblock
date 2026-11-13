import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const builtWorkerPath = fileURLToPath(new URL("./build/worker/worker.js", import.meta.url));

/**
 * Resolves the build-time virtual module that carries the bundled worker source.
 *
 * Tests that need the real worker must run after `pnpm build` (CI does build before test);
 * otherwise a clearly-marked placeholder string is served so pure-logic tests still load.
 */
function workerSourceForTests(): Plugin {
  const virtualId = "virtual:typed-codeblocks-worker";
  const resolvedId = `\0${virtualId}`;
  return {
    name: "typed-codeblocks-worker-source",
    resolveId(id) {
      return id === virtualId ? resolvedId : undefined;
    },
    load(id) {
      if (id !== resolvedId) return undefined;
      const workerSource = existsSync(builtWorkerPath)
        ? readFileSync(builtWorkerPath, "utf8")
        : "/* typed-codeblocks worker not built: run `pnpm build` */";
      return `export default ${JSON.stringify(workerSource)};`;
    },
  };
}

export default defineConfig({
  plugins: [workerSourceForTests()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["tests/dom/**/*.test.ts"],
        },
      },
    ],
  },
});
