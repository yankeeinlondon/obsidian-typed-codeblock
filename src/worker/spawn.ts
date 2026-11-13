import bundledWorkerSource from "virtual:typed-codeblocks-worker";

/** A worker created from an inlined source string, plus control over its Blob URL. */
export interface BlobWorkerHandle {
  worker: Worker;
  /**
   * Revokes the Blob URL. Idempotent. Call it once the worker acknowledges startup, when
   * startup fails, or on disposal (FR-23); the running worker is unaffected by revocation.
   */
  revokeUrl(): void;
}

/** Minimal environment needed to create a Blob-URL worker; injectable for tests. */
export interface BlobWorkerEnvironment {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createWorker(url: string): Worker;
}

const defaultEnvironment = (): BlobWorkerEnvironment => ({
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createWorker: (url) => new Worker(url, { name: "obsidian-typed-codeblocks" }),
});

/**
 * Creates a Web Worker from a self-contained script string via a Blob URL (FR-23).
 *
 * No worker loader, extra file, dynamic chunk or network fetch is involved. If construction
 * throws, the Blob URL is revoked before the error propagates.
 *
 * @internal Phase-1 scaffold; the worker client of Phase 4 owns the full lifecycle.
 */
export function createBlobWorker(
  workerSource: string = bundledWorkerSource,
  environment: BlobWorkerEnvironment = defaultEnvironment(),
): BlobWorkerHandle {
  const blobUrl = environment.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  let revoked = false;
  const revokeUrl = (): void => {
    if (revoked) return;
    revoked = true;
    environment.revokeObjectURL(blobUrl);
  };
  try {
    return { worker: environment.createWorker(blobUrl), revokeUrl };
  } catch (constructionError) {
    revokeUrl();
    throw constructionError;
  }
}
