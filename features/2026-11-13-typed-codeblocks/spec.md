# Typed Code Blocks: Specification

- **Status:** Draft
- **Date:** 2026-11-13
- **Package:** `obsidian-typed-codeblocks`
- **Primary consumer:** `obsidian-kind-model` (other Obsidian plugins are equally in scope)

## 1. Summary

A library that an Obsidian plugin bundles to make **its own fenced code blocks type-aware in the editor**. The plugin declares which fence languages it owns (e.g. ` ```km-ts `) and supplies a TypeScript declaration file describing the globals its runtime injects (e.g. `declare const km: KindModelApi`). Inside those fences the author then gets:

- completions driven by the real type system (including generics and fluent APIs);
- type errors as lint squiggles;
- hover type information;
- TypeScript/JavaScript syntax highlighting.

It is the CodeMirror 6 / Obsidian equivalent of Monaco's `addExtraLib`, scoped to code blocks inside Markdown notes.

## 2. Goals

1. Real TypeScript semantics (the TypeScript language service, not a heuristic) for code inside designated fences.
2. Consumer-supplied globals: one or more `.d.ts` sources, replaceable at runtime.
3. Support both TypeScript and JavaScript fences (JS is checked via `checkJs` + JSDoc).
4. Work in Obsidian's editing view: Live Preview and Source mode.
5. Coexist with Obsidian, other plugins, and other CM6 extensions (no global overrides of autocomplete/lint behaviour).
6. Zero cost for notes without typed fences: TypeScript is loaded lazily, off the main thread.
7. A small, stable consumer API; consumers never touch TypeScript or worker plumbing.

## 3. Non-goals

- **Owning execution.** Deciding when and where a block runs, and rendering its output, stays with the consuming plugin. The library only provides the optional `obsidian-typed-codeblocks/run` helper (§5.9) so that what runs matches what was checked.
- Reading view features (highlighting/diagnostics in rendered output).
- npm package resolution / automatic type acquisition, `import` of external modules.
- IDE refactors: rename, extract, organise imports, go-to-definition.
- Inferring types from vault content (frontmatter schemas etc.). Consumers may generate such types and pass them as globals.
- Sharing a TypeScript worker between consuming plugins.
- Typing inline code (`` `$= …` ``) or code outside fenced blocks.

## 4. Consumer experience

### 4.1 Registration

```ts
import { typedCodeBlocks } from "obsidian-typed-codeblocks";
import kmGlobals from "./generated/km-globals.d.ts?raw";

export default class KindModelPlugin extends Plugin {
  async onload() {
    const typed = typedCodeBlocks({
      id: "kind-model",                         // unique per consumer; used in diagnostics source + registry
      fences: { "km-ts": "ts", "km-js": "js" }, // fence info string → language
      globals: { "/km-globals.d.ts": kmGlobals },
      wrap: "async-function",                   // allows top-level await / return
    });

    this.registerEditorExtension(typed.extension);
    this.register(() => typed.dispose());
  }
}
```

### 4.2 Runtime updates

```ts
await typed.updateGlobals({ "/km-globals.d.ts": regenerated }); // re-checks open blocks
typed.setEnabled(false);                                         // e.g. from a settings toggle
```

### 4.3 What the author sees

Assume the consumer declares:

```ts
interface Query<Used extends string = never> {
  where(expr: string): Omit<Query<Used | "where">, Used | "where">;
  sortBy(field: string): Omit<Query<Used | "sortBy">, Used | "sortBy">;
  limit(n: number): Omit<Query<Used | "limit">, Used | "limit">;
  run(): Promise<PageInfo[]>;
}
declare const km: {
  getPageInfo(ref: PageRef): PageInfo | undefined;
  query(): Query;
};
```

| Scenario | Author writes | Result |
|---|---|---|
| Member completion | `km.` | `getPageInfo`, `query` with signatures and JSDoc |
| Argument type error | `km.getPageInfo(42)` | squiggle: `Argument of type 'number' is not assignable to parameter of type 'PageRef'.` |
| Misspelled member | `info.titel` | squiggle with `Did you mean 'title'?`; quick fix applies the suggestion |
| Inference through user code | `const names = (await km.query().run()).map(p => p.name)` | hover `names` → `string[]` |
| Fluent / generic narrowing | `km.query().where("…").` | completion offers `sortBy`, `limit`, `run` only |
| Fluent misuse | `km.query().limit(5).limit(10)` | squiggle: `Property 'limit' does not exist on type …` |
| JS block | `/** @type {number} */ let n = 1; n = "x";` in `km-js` | squiggle: `Type 'string' is not assignable to type 'number'.` |
| Hover | cursor over any identifier | resolved type + documentation |
| Multiple blocks | two `km-ts` blocks in a note | each checked independently, both see the globals |

## 5. Functional requirements

### 5.1 Fence detection

- **FR-1** Recognise fenced blocks whose info string's first word matches a key of `fences` (case-sensitive), with backtick or tilde fences of length ≥ 3, and a closing fence of the same character and ≥ the opening length.
- **FR-2** Support fences indented inside list items.
- **FR-3** Support fences inside callouts/blockquotes, including nested (`> > `), loosely spaced (`>`, `>   `) and mixed with list indentation (decision Q5). One per-line **prefix mapper** handles indentation and `>` markers for both FR-2 and FR-3: it strips each content line's container prefix for the virtual file and records it for position mapping (FR-8). Container rules follow CommonMark: a line without the enclosing `>` marker ends the fenced block (no lazy continuation).
- **FR-4** An unclosed fence extends to the end of the document (matches Obsidian behaviour) and is still checked.
- **FR-5** Detection uses a text scan of the document, not Obsidian's syntax-tree node names (which are undocumented and change between versions). Ranges are kept in a `StateField`, re-scanned incrementally from the first changed line.

### 5.2 Virtual files and position mapping

- **FR-6** Each typed block maps to one virtual file `/blocks/<editorId>/<n>.<ts|js>`. Blocks never share scope (`moduleDetection: force`); all share the consumer's globals.
- **FR-7** `wrap` options:
  - `"none"`: the block is the file verbatim;
  - `"async-function"`: `(async () => {\n` + block + `\n})();`;
  - `{ prefix, suffix }`: custom.
- **FR-8** A bidirectional position map converts document offsets ↔ virtual-file offsets (accounting for wrap prefix and per-line container prefixes from FR-3). Results that map into the wrap prefix/suffix or into a container prefix are dropped or clamped to the nearest code position. Round-trip property tests cover lists, callouts, nesting and mixes.
- **FR-9** Virtual files are created/updated/deleted as blocks appear, change and disappear; all files for an editor are removed when the editor is destroyed.

### 5.3 Completion

- **FR-10** Completions come from `getCompletionsAtPosition` + `getCompletionEntryDetails` (lazy `info`), mapped to CM6 `Completion` types (property, method, function, variable, constant, class, type, keyword).
- **FR-11** The source is contributed through language data / an additional completion source, **never** `autocompletion({ override })`, so other plugins' completions (e.g. kind-model's `km` fences) keep working. It returns `null` outside typed blocks.
- **FR-12** Triggers: identifier characters and `.`; explicit trigger (Ctrl-Space). Uses `validFor` to filter client-side while typing an identifier.
- **FR-13** Async completions honour `CompletionContext.aborted`; stale responses are discarded.

### 5.4 Diagnostics

- **FR-14** Syntactic + semantic diagnostics per block via a CM6 `linter` (300 ms default delay, configurable), severity mapped from `DiagnosticCategory`, `source: "<id> ts(<code>)"`.
- **FR-15** Diagnostics caused by the wrapper are suppressed. Consumers can suppress further codes via `ignoreDiagnostics: number[]`.
- **FR-16** Quick fixes: offer TypeScript spelling fixes (`getCodeFixesAtPosition`, fix name `fixSpelling`) as diagnostic actions. Other code fixes are out of scope for v1.
- **FR-17** Diagnostics are only emitted inside typed blocks and are updated after `updateGlobals`.

### 5.5 Hover

- **FR-18** `hoverTooltip` using `getQuickInfoAtPosition`: type signature (monospace, highlighted), JSDoc text, and `@param`/`@returns` tags.

### 5.6 Highlighting

- **FR-19** For fence names Obsidian already highlights (e.g. `ts`, `js`), the library adds no highlighting.
- **FR-20** For custom fence names (e.g. `km-ts`), the library highlights block content by parsing it with the Lezer TypeScript/JavaScript parser and emitting mark decorations. It uses the same CSS classes Obsidian uses for code-block tokens so themes apply unchanged. **Acceptance:** a `km-ts` block is visually indistinguishable from the same code in a `ts` block under the default theme and one popular community theme.
- **FR-21** Highlighting doesn't depend on TypeScript having loaded.

### 5.7 Lifecycle and loading

- **FR-22** No TypeScript code is loaded until a typed block exists in an open editor. Loading starts then; until ready, completion/lint/hover return nothing (highlighting still works).
- **FR-23** The language service runs in a Web Worker created from an inlined source (Blob URL), so consumers need no worker bundling configuration.
- **FR-24** `dispose()` terminates the worker and releases all state. Disabling then re-enabling works without reloading Obsidian.
- **FR-25** `mobile` option (default `false`): on Obsidian mobile the extension reduces to highlighting only unless enabled.

### 5.8 Multiple consumers

- **FR-26** A small global registry (`globalThis.__typedCodeBlocks`, versioned) records each consumer `id` and its fences. Two consumers claiming the same fence name: the later one logs a warning and doesn't attach to that fence.
- **FR-26a** Any fence name may be claimed, including generic language names (`ts`, `js`, `typescript`, …) and other plugins' fences (`dataviewjs`) (decision Q3). The README warns that claiming a generic name checks every such block in the vault against the consumer's globals, producing errors on ordinary snippets, and that only one consumer can own a name.
- **FR-27** Each consumer runs its own worker. Workers are never shared between consumers (decision Q2); duplicate TypeScript instances are accepted and documented.
- **FR-27a** Worker messages carry `protocolVersion`, and the worker keeps its files under a per-consumer namespace (`/<id>/…`). This is cheap insurance; it does not imply future sharing.

### 5.9 Run helper (`obsidian-typed-codeblocks/run`)

Rationale: the checker sees the block wrapped, type-stripped and with declared globals in scope. If the consumer runs it any other way, code that checks cleanly can fail at runtime (top-level `await`/`return` outside a wrapper, unstripped TS syntax, globals declared but not injected). The helper removes that gap by sharing the editor's options.

- **FR-28** A separate entry point `obsidian-typed-codeblocks/run`. Importing the main entry doesn't pull in the run helper, and vice versa.
- **FR-29** `compileBlock(source, { lang, wrap })` returns JavaScript: TS syntax stripped (for `lang: "ts"`), then the **same** wrap as the editor side (§5.2, FR-7).
- **FR-30** `runBlock(source, { lang, wrap, globals })` compiles and then executes with `new Function(...Object.keys(globals), js)`, passing the values. It returns the block's completion value (the wrapper's resolved value for `async-function`, so `return x` in a block yields `x`).
- **FR-31** Type stripping is synchronous on the main thread using a lightweight stripper (e.g. Sucrase), **not** the TypeScript worker. Rendering in Reading view must never boot TypeScript.
- **FR-32** Development-mode check (opt-in `verifyGlobals: string | Record<string,string>` taking the `.d.ts` source): warn once when a key in `globals` is not declared, or a declared global is missing from `globals`. Declaration names come from a cheap scan of top-level `declare const|let|var|function` names, not from the TS compiler.
- **FR-33** Errors thrown by the block are rethrown with a source location mapped back to the original block (line/column), stripped of wrapper offsets.
- **FR-34** Syntax the stripper doesn't support (e.g. legacy `namespace` merging) produces a clear error naming the construct; it is listed in the README as a known mismatch with the checker.

```ts
import { runBlock } from "obsidian-typed-codeblocks/run";

this.registerMarkdownCodeBlockProcessor("km-ts", async (source, el, ctx) => {
  const result = await runBlock(source, {
    lang: "ts",
    wrap: "async-function",                     // share this object with typedCodeBlocks()
    globals: { km: this.api, dv: getAPI(this.app), el, ctx },
  });
});
```

## 6. Public API (v1)

```ts
export interface TypedCodeBlocksOptions {
  id: string;
  fences: Record<string, "ts" | "js">;
  globals: Record<string, string>;            // virtual path → .d.ts contents
  wrap?: "none" | "async-function" | { prefix: string; suffix: string }; // default "none"
  compilerOptions?: Partial<CompilerOptionsSubset>; // merged over defaults (§7.3)
  libs?: Array<"es2022" | "es2023" | "es2024" | "dom">;  // default ["es2022"]
  ignoreDiagnostics?: number[];
  lintDelay?: number;                          // default 300 ms
  features?: { completion?: boolean; diagnostics?: boolean; hover?: boolean; highlight?: boolean };
  mobile?: boolean;                            // default false
  onError?: (error: unknown) => void;          // worker/boot failures; default console.error
}

export interface TypedCodeBlocks {
  extension: Extension;                         // pass to registerEditorExtension
  updateGlobals(files: Record<string, string>): Promise<void>;
  setEnabled(enabled: boolean): void;
  ready(): Promise<void>;                       // resolves when the language service is warm
  dispose(): void;
}

export function typedCodeBlocks(options: TypedCodeBlocksOptions): TypedCodeBlocks;
```

Options are validated at call time; invalid options throw synchronously with a descriptive message.

## 7. Architecture

### 7.1 Components

```
Main thread (per Obsidian editor)                     Worker (one per consumer)
┌──────────────────────────────────────────┐          ┌───────────────────────────────┐
│ fenceField (StateField: block ranges)    │          │ @typescript/vfs environment   │
│ highlighter (ViewPlugin, Lezer)          │  RPC     │  lib .d.ts (bundled)          │
│ syncPlugin (ViewPlugin → file updates)   │ ───────▶ │  consumer globals             │
│ completion source / linter / hover       │ ◀─────── │  /blocks/<editor>/<n>.ts      │
│ position maps                            │          │ LanguageService queries       │
└──────────────────────────────────────────┘          └───────────────────────────────┘
```

### 7.2 Worker protocol

- Typed request/response messages with a request id and `protocolVersion` (FR-27a). No Comlink dependency unless it proves simpler.
- Operations: `init(globals, compilerOptions, libs)`, `setFiles(updates[])`, `deleteFiles(paths[])`, `completions(path, pos)`, `completionDetails(path, pos, name, source, data)`, `diagnostics(path)`, `quickInfo(path, pos)`, `codeFixes(path, start, end, codes)`, `updateGlobals(files)`.
- File updates carry a monotonically increasing version. Queries carry the version they were computed against; the main thread discards responses for stale versions.
- Sending updates is debounced per block (≤ 50 ms) and always flushed before a query.

### 7.3 TypeScript configuration

- **TypeScript 6.x is bundled** (npm alias, e.g. `"typescript": "npm:typescript@^6"`). TypeScript 7 ships native binaries with no in-process JS API and cannot be embedded.
- Default compiler options: `target ES2022`, `lib` from `libs`, `strict: true`, `allowJs: true`, `checkJs: true`, `noEmit: true`, `module: ESNext`, `moduleDetection: Force`, `skipLibCheck: true`, `types: []`.
- Lib `.d.ts` files are bundled into the worker (no CDN fetch; Obsidian must work offline).

### 7.4 Packaging

- Dist: ESM + CJS entry for the main-thread code, worker bundled to a string and inlined.
- `@codemirror/*` and `@lezer/*` are **peerDependencies** and must stay external in consumer builds (Obsidian provides them).
- `obsidian` is a peerDependency (types only; used for `Platform` detection).
- No top-level use of Node built-ins (Obsidian mobile compatibility).

## 8. Limitations (documented for consumers)

1. **Type quality equals declaration quality.** Untyped data (e.g. Dataview's `dv.pages()` returns `DataArray<any>` with an index signature) gets no checking.
2. Editing view only. In Live Preview, if a consumer renders the block when the cursor is outside it, the source and its diagnostics are visible only while editing the block.
3. Blocks are isolated: no shared variables between blocks, no imports, no npm types.
4. Type-level checks only: string contents (e.g. query DSLs) are not verified. Whether the runtime provides the declared globals is only checked when the consumer uses `runBlock` with `verifyGlobals` (§5.9).
5. Bundle size: several MB added to the consumer's `main.js`; first-use warm-up of roughly a second (target, see §9).
6. Heavy type-level code (deep recursive conditional types) is as slow as in VS Code and can hit "excessively deep" errors.
7. One TypeScript instance (worker) per consuming plugin; memory and cold start scale with the number of consumers.
8. Inside callouts/blockquotes, edits that insert multiple lines (e.g. multi-line snippets) are not re-prefixed with `> `. No v1 feature produces such edits.
9. Bundled TypeScript is 6.x; behaviour that differs in 7.x won't be reflected.

## 9. Non-functional requirements

| Metric | Target (desktop, warm) |
|---|---|
| Keystroke latency added on the main thread | < 2 ms p95 |
| Completion response | < 100 ms p95 for blocks ≤ 300 lines with a ≤ 5k-line globals file |
| Diagnostics after the lint delay | < 150 ms p95 |
| Cold start (first typed block → first completion) | < 1.5 s |
| Notes with no typed blocks | no worker, no TypeScript loaded, no measurable overhead |
| Added bundle size | measured and reported in README; budget decided after the first build |

## 10. Testing

- **Unit (Vitest, no DOM):** fence scanner (backtick/tilde, lengths, lists, callouts, unclosed), position mapping round-trips, wrap handling, diagnostic filtering, option validation.
- **Language-service integration (Vitest, Node):** run the worker core directly (TypeScript works in Node): completions on globals, generic/fluent narrowing, JS `checkJs`, spelling quick fix, `updateGlobals` invalidation.
- **CM6 state tests:** `EditorState` + extensions, asserting block ranges and decorations after transactions.
- **Type tests:** public API typings.
- **Manual / e2e:** a fixture vault and a minimal example consumer plugin in `examples/`, exercised in Obsidian (desktop + mobile highlight-only mode), alongside the kind-model plugin to verify coexistence with its `km` completion and linter.

## 11. Milestones

1. **M1 – Core:** fence scanner, per-line prefix mapper (lists + callouts), position maps, worker + vfs, diagnostics, completion, hover for `ts` fences with `wrap: "none"`.
2. **M2 – Obsidian polish:** custom-fence highlighting, wrap modes, JS fences, lazy loading, mobile option, registry.
3. **M3 – Quality + run helper:** spelling quick fixes, `obsidian-typed-codeblocks/run` (§5.9), performance budget verification, example plugin, docs; integrate into kind-model.
4. **v2 candidates:** semantic highlighting (`getEncodedSemanticClassifications`), signature help, per-note globals helper.

## 12. Decisions

| # | Decision | Date |
|---|---|---|
| Q1 | Ship the run helper as a separate entry point in M3, with a synchronous lightweight stripper (§5.9) | 2026-11-13 |
| Q2 | Do not share workers between consumers; one worker per consuming plugin (FR-27) | 2026-11-13 |
| Q3 | Allow any fence name, including generic `ts`/`js`; documented warning only (FR-26a) | 2026-11-13 |
| Q4 | npm package name `obsidian-typed-codeblocks` (repo folder name unchanged) | 2026-11-13 |
| Q5 | Callout/blockquote support in M1 via the shared per-line prefix mapper; no "ignore block" fallback (FR-3) | 2026-11-13 |
