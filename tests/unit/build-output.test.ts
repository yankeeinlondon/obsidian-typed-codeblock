/**
 * Tests against the real build artifacts (`pnpm build` output). CI runs `pnpm build` before
 * `pnpm test`; `just test` builds first. A missing build is a hard failure, never a skip.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const workerPath = `${repoRoot}build/worker/worker.js`;
const requireFromRepo = createRequire(`${repoRoot}package.json`);

beforeAll(() => {
  for (const builtFile of [workerPath, `${repoRoot}dist/index.js`, `${repoRoot}dist/index.cjs`, `${repoRoot}dist/run.js`]) {
    if (!existsSync(builtFile)) throw new Error(`${builtFile} is missing: run \`pnpm build\` before the test suite`);
  }
});

describe("package exports", () => {
  it("resolves the root entry in ESM and CJS through the package exports map", async () => {
    const esmRoot = (await import("obsidian-typed-codeblocks")) as Record<string, unknown>;
    const cjsRoot = requireFromRepo("obsidian-typed-codeblocks") as Record<string, unknown>;
    expect(typeof esmRoot.createBlobWorker).toBe("function");
    expect(typeof cjsRoot.createBlobWorker).toBe("function");
    expect(requireFromRepo.resolve("obsidian-typed-codeblocks")).toMatch(/dist[\\/]index\.cjs$/);
  });

  it("resolves the /run entry in ESM and CJS", async () => {
    await expect(import("obsidian-typed-codeblocks/run")).resolves.toBeDefined();
    expect(requireFromRepo("obsidian-typed-codeblocks/run")).toBeDefined();
    expect(requireFromRepo.resolve("obsidian-typed-codeblocks/run")).toMatch(/dist[\\/]run\.cjs$/);
  });

  it("emits declaration files for both entries and both formats", () => {
    for (const declarationFile of ["index.d.ts", "index.d.cts", "run.d.ts", "run.d.cts"]) {
      expect(existsSync(`${repoRoot}dist/${declarationFile}`), declarationFile).toBe(true);
    }
  });

  it("inlines the stage-1 worker source verbatim into the root entry (no ?raw/loader needed)", async () => {
    const workerSource = readFileSync(workerPath, "utf8");
    const recordedBlobs: Blob[] = [];
    const recordingEnvironment = {
      createObjectURL: (blob: Blob) => {
        recordedBlobs.push(blob);
        return "blob:test";
      },
      revokeObjectURL: () => undefined,
      createWorker: () => ({}) as Worker,
    };
    type CreateBlobWorker = (source: string | undefined, environment: typeof recordingEnvironment) => unknown;
    const esmRoot = (await import("obsidian-typed-codeblocks")) as { createBlobWorker: CreateBlobWorker };
    const cjsRoot = requireFromRepo("obsidian-typed-codeblocks") as { createBlobWorker: CreateBlobWorker };
    esmRoot.createBlobWorker(undefined, recordingEnvironment);
    cjsRoot.createBlobWorker(undefined, recordingEnvironment);
    expect(recordedBlobs).toHaveLength(2);
    for (const recordedBlob of recordedBlobs) expect(await recordedBlob.text()).toBe(workerSource);
  });

  it("keeps host packages external and bundles nothing editor-related into /run", () => {
    const runBundle = readFileSync(`${repoRoot}dist/run.js`, "utf8") + readFileSync(`${repoRoot}dist/run.cjs`, "utf8");
    expect(runBundle).not.toMatch(/typescript|@codemirror|@lezer|obsidian/);
  });
});

interface WorkerMessage {
  op?: string;
  id?: number;
  ok?: boolean;
  display?: string | null;
  typescriptVersion?: string;
  libFileCount?: number;
}

/**
 * Evaluates the built worker script in a fresh V8 context that only has what a Web Worker
 * offers (no `require`, `process`, `module` or DOM), proving it is self-contained.
 */
function startSandboxedWorker(extraGlobals: Record<string, unknown> = {}) {
  const messages: WorkerMessage[] = [];
  const sandbox: Record<string, unknown> = {
    performance,
    console,
    postMessage: (message: WorkerMessage) => messages.push(message),
    onmessage: null,
    ...extraGlobals,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  runInNewContext(readFileSync(workerPath, "utf8"), sandbox, { filename: "worker.js" });
  const send = (request: unknown): WorkerMessage => {
    const handler = sandbox.onmessage as (event: { data: unknown }) => void;
    handler({ data: request });
    return messages[messages.length - 1] as WorkerMessage;
  };
  return { messages, send, sandbox };
}

describe("bundled worker script", () => {
  it("starts without Node globals and answers a quick-info query with TypeScript 6.x", () => {
    const sandboxedWorker = startSandboxedWorker();
    expect(sandboxedWorker.sandbox.require).toBeUndefined();
    expect(sandboxedWorker.messages[0]).toMatchObject({ op: "ready" });
    expect(sandboxedWorker.messages[0]!.typescriptVersion).toMatch(/^6\./);
    expect(sandboxedWorker.messages[0]!.libFileCount).toBeGreaterThan(50);

    const code = "const doubled = [1, 2].map((n) => n * 2);";
    const reply = sandboxedWorker.send({ id: 7, op: "quickInfo", code, position: code.indexOf("doubled") });
    expect(reply).toMatchObject({ id: 7, ok: true, display: "const doubled: number[]" });
  });

  it("stays on the browser code path inside an Obsidian desktop worker that exposes Node globals", () => {
    // Spike S1: Obsidian desktop workers have Node integration (`process`, `require`, `module`).
    // TypeScript then picked its Node `sys` and crashed calling `os.platform()` on the empty
    // built-in shim ("l.platform is not a function"). The worker must ignore these globals.
    const requiredModules: string[] = [];
    const obsidianLikeGlobals = {
      process: { nextTick: () => undefined, env: {}, versions: { node: "22.0.0" }, platform: "darwin", browser: undefined },
      require: (moduleName: string) => {
        requiredModules.push(moduleName);
        throw new Error(`worker must not require ${moduleName}`);
      },
      module: { exports: {} },
    };
    const sandboxedWorker = startSandboxedWorker(obsidianLikeGlobals);
    expect(sandboxedWorker.messages[0]).toMatchObject({ op: "ready" });
    const code = "const total = 1 + 2;";
    expect(sandboxedWorker.send({ id: 3, op: "quickInfo", code, position: code.indexOf("total") })).toMatchObject({
      ok: true,
      display: "const total: number",
    });
    expect(requiredModules).toEqual([]);
  });

  it("has no DOM or Node globals in the default es2022 lib, and rejects unknown operations", () => {
    const sandboxedWorker = startSandboxedWorker();
    // With lib.dom loaded these would be `var document: Document` / `var process: NodeJS.Process`;
    // unresolved names report `any`.
    for (const globalName of ["document", "process", "window"]) {
      const code = `const probe = ${globalName};`;
      const reply = sandboxedWorker.send({ id: 1, op: "quickInfo", code, position: code.indexOf(globalName) });
      expect(reply.display, globalName).toBe("any");
    }
    expect(sandboxedWorker.send({ id: 2, op: "explode" })).toMatchObject({ id: 2, ok: false, error: "unknown op: explode" });
  });
});
