/**
 * Worker entry, bundled to a self-contained string in build stage 1.
 *
 * Phase 1 (spike S1) implementation: proves TypeScript 6.x + @typescript/vfs + bundled libs
 * run inside a Blob-URL worker and answer one quick-info query. Phase 4 replaces the message
 * handling with the versioned RPC protocol over `core.ts`; keep this file free of DOM, Node
 * built-ins and `importScripts`.
 */
import { createSystem, createVirtualTypeScriptEnvironment } from "@typescript/vfs";
import ts from "typescript";
import libFiles from "virtual:typed-codeblocks-libs";

interface QuickInfoRequest {
  id: number;
  op: "quickInfo";
  code: string;
  position: number;
}

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

const workerScope = globalThis as unknown as WorkerScope;
const blockPath = "/spike/block.ts";

const initStartedAt = performance.now();
const fileMap = new Map<string, string>(Object.entries(libFiles));
// @typescript/vfs treats an empty string as a missing file, so seed with a newline.
fileMap.set(blockPath, "\n");
const environment = createVirtualTypeScriptEnvironment(createSystem(fileMap), [blockPath], ts, {
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2022.d.ts"],
  strict: true,
  noEmit: true,
  moduleDetection: ts.ModuleDetectionKind.Force,
  types: [],
});
// Force the program (and lib binding) to be created before reporting readiness.
environment.languageService.getProgram();
workerScope.postMessage({
  op: "ready",
  initMs: performance.now() - initStartedAt,
  typescriptVersion: ts.version,
  libFileCount: Object.keys(libFiles).length,
});

workerScope.onmessage = (event) => {
  const request = event.data as QuickInfoRequest;
  if (request.op !== "quickInfo") {
    workerScope.postMessage({ id: request.id, ok: false, error: `unknown op: ${String(request.op)}` });
    return;
  }
  const queryStartedAt = performance.now();
  environment.updateFile(blockPath, request.code);
  const quickInfo = environment.languageService.getQuickInfoAtPosition(blockPath, request.position);
  workerScope.postMessage({
    id: request.id,
    ok: true,
    display: quickInfo ? ts.displayPartsToString(quickInfo.displayParts) : null,
    queryMs: performance.now() - queryStartedAt,
  });
};
