/**
 * Computes the transitive `/// <reference lib="…" />` closure of TypeScript standard libs.
 */

const libReferencePattern = /^\/\/\/\s*<reference\s+lib="([^"]+)"\s*\/>/gm;

/** File name of a lib reference, e.g. `es2015.core` → `lib.es2015.core.d.ts`. */
export const libFileName = (libName: string): string => `lib.${libName.toLowerCase()}.d.ts`;

/**
 * Returns the sorted closure of lib file names reachable from `rootLibNames`.
 *
 * `readLibFile` receives a lib file name and returns its text; it must throw for unknown libs
 * so a typo in the advertised set fails the build rather than shipping an incomplete closure.
 */
export function collectLibClosure(
  rootLibNames: readonly string[],
  readLibFile: (fileName: string) => string,
): string[] {
  const visitedFileNames = new Set<string>();
  const pendingFileNames = rootLibNames.map(libFileName);
  while (pendingFileNames.length > 0) {
    const fileName = pendingFileNames.pop() as string;
    if (visitedFileNames.has(fileName)) continue;
    visitedFileNames.add(fileName);
    const libText = readLibFile(fileName);
    for (const referenceMatch of libText.matchAll(libReferencePattern)) {
      pendingFileNames.push(libFileName(referenceMatch[1] as string));
    }
  }
  return [...visitedFileNames].sort();
}
