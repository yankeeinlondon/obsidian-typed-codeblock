/**
 * Build-time virtual modules (see `scripts/build.ts`).
 */

/** The fully bundled, self-contained worker script as a string (stage 1 of the build). */
declare module "virtual:typed-codeblocks-worker" {
  const workerSource: string;
  export default workerSource;
}

/** Bundled TypeScript standard-library declaration files, keyed by `/lib.*.d.ts` path. */
declare module "virtual:typed-codeblocks-libs" {
  const libFiles: Record<string, string>;
  export default libFiles;
}
