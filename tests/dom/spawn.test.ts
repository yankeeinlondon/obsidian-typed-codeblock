import { describe, expect, it } from "vitest";
import { createBlobWorker, type BlobWorkerEnvironment } from "../../src/worker/spawn.ts";

const recordingEnvironment = (options: { failConstruction?: Error } = {}) => {
  const createdBlobs: Blob[] = [];
  const revokedUrls: string[] = [];
  const workerUrls: string[] = [];
  const fakeWorker = { terminate() {} } as unknown as Worker;
  const environment: BlobWorkerEnvironment = {
    createObjectURL: (blob) => {
      createdBlobs.push(blob);
      return `blob:test/${createdBlobs.length}`;
    },
    revokeObjectURL: (url) => revokedUrls.push(url),
    createWorker: (url) => {
      workerUrls.push(url);
      if (options.failConstruction) throw options.failConstruction;
      return fakeWorker;
    },
  };
  return { environment, createdBlobs, revokedUrls, workerUrls, fakeWorker };
};

describe("createBlobWorker", () => {
  it("creates the worker from a JavaScript Blob URL holding the given source", async () => {
    const recorder = recordingEnvironment();
    const handle = createBlobWorker("postMessage(1);", recorder.environment);
    expect(handle.worker).toBe(recorder.fakeWorker);
    expect(recorder.workerUrls).toEqual(["blob:test/1"]);
    expect(recorder.createdBlobs[0]!.type).toBe("text/javascript");
    expect(await recorder.createdBlobs[0]!.text()).toBe("postMessage(1);");
    expect(recorder.revokedUrls).toEqual([]);
  });

  it("revokes the URL exactly once however often revokeUrl is called", () => {
    const recorder = recordingEnvironment();
    const handle = createBlobWorker("", recorder.environment);
    handle.revokeUrl();
    handle.revokeUrl();
    expect(recorder.revokedUrls).toEqual(["blob:test/1"]);
  });

  it("revokes the URL and rethrows when worker construction fails (e.g. host blocks Blob workers)", () => {
    const blocked = new Error("Blob workers are blocked by CSP");
    const recorder = recordingEnvironment({ failConstruction: blocked });
    expect(() => createBlobWorker("", recorder.environment)).toThrow(blocked);
    expect(recorder.revokedUrls).toEqual(["blob:test/1"]);
  });

  it("defaults to the bundled worker source", async () => {
    const recorder = recordingEnvironment();
    createBlobWorker(undefined, recorder.environment);
    expect((await recorder.createdBlobs[0]!.text()).length).toBeGreaterThan(0);
  });
});
