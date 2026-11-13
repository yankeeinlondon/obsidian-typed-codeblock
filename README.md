# obsidian-typed-codeblocks

**Real TypeScript completions, type errors and hover info inside the code blocks of a Markdown note, for Obsidian plugin authors.**

> [!WARNING]
> **Pre-release.** This library is being built from [the specification](features/2026-11-13-typed-codeblocks/spec.md) under an [8-phase plan](features/2026-11-13-typed-codeblocks/plan.md). The build pipeline and the Blob-worker spike are done. Most features below are **specified, not shipped yet**. The README describes the v1 contract the implementation targets. Progress is tracked in the [implementation log](features/2026-11-13-typed-codeblocks/implementation-log.md).

---

## Contents

- [The problem in one picture](#the-problem-in-one-picture)
- [Background for newcomers](#background-for-newcomers)
- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [Writing the declaration file](#writing-the-declaration-file)
- [Running blocks: `obsidian-typed-codeblocks/run`](#running-blocks-obsidian-typed-codeblocksrun)
- [API reference](#api-reference)
- [Supported TypeScript](#supported-typescript)
- [Living with other plugins](#living-with-other-plugins)
- [How it works](#how-it-works)
- [Performance and bundle size](#performance-and-bundle-size)
- [Limitations](#limitations)
- [Developing this repository](#developing-this-repository)
- [Licences](#licences)

---

## The problem in one picture

Some Obsidian plugins let users write small scripts inside their notes. The plugin then runs each script with a few objects injected into scope:

````markdown
## Recent reading

```km-ts
const books = await km.query().where("kind = 'book'").sortBy("date").run();
return books.map(b => b.titel);   // typo, but nothing tells you
```
````

The plugin knows what `km` is. The editor doesn't. To the editor this is plain text, so the author gets no completions, no type errors, and no hints about the API.

This library closes that gap. A plugin hands it a TypeScript declaration file (`declare const km: KindModelApi`) and the fence names it owns (`km-ts`). In return, the user gets a small TypeScript editor inside each of those blocks:

```text
return books.map(b => b.titel);
                        ~~~~~  Property 'titel' does not exist on type 'PageInfo'.
                               Did you mean 'title'?   [Quick fix: Change spelling to 'title']
```

If you know Monaco, this is the `addExtraLib` feature, built for code blocks inside Markdown in Obsidian's editor.

---

## Background for newcomers

You don't need to know Obsidian or CodeMirror to follow this README. Here are the few concepts it relies on.

| Term | What it means here |
|---|---|
| **Obsidian** | A desktop and mobile note-taking app. Notes are plain Markdown files in a folder called a **vault**. |
| **Obsidian plugin** | A JavaScript bundle (`main.js`) that Obsidian loads at startup. Plugins are written in TypeScript and bundled into **one CommonJS file**. Some modules, such as `obsidian` and the CodeMirror packages, are supplied by the host app at runtime and must stay **external** in the bundle. |
| **Fenced code block / fence** | A Markdown block delimited by ```` ``` ```` or `~~~`. The first word after the opening fence is the **info string**, such as `ts` or `km-ts`. Plugins claim custom info strings and give those blocks their own behaviour. |
| **Live Preview / Source mode** | Obsidian's two *editing* views. Live Preview renders Markdown inline while you type. Source mode shows the raw text. **Reading view** is the separate, read-only rendered view. |
| **CodeMirror 6 (CM6)** | The text editor component inside Obsidian's editing views. It is extended with *extensions*: state fields, view plugins, autocompletion sources, linters and hover tooltips. Obsidian lets a plugin add these with `registerEditorExtension`. |
| **Callout** | Obsidian's styled blockquote (`> [!note] Title`). A code block can live inside one, so every code line starts with `> `. |
| **TypeScript language service** | The engine behind VS Code's TypeScript support. It answers questions such as "what completes here?", "what are the errors?" and "what type is this?". |

Code blocks in notes are harder to support than standalone `.ts` files. A block may be nested in lists, quotes and callouts. Its lines may carry `> ` or indentation prefixes that are not code. It shares a document with prose that changes on every keystroke. And the note may contain several blocks that must not see each other's variables.

---

## What you get

Inside every fence your plugin owns, in Live Preview and Source mode:

| Feature | Example |
|---|---|
| **Completions** from the real type system, including generics and fluent APIs | `km.` → `getPageInfo`, `query`, with signatures and JSDoc |
| **Type errors** as lint squiggles | `km.getPageInfo(42)` → `Argument of type 'number' is not assignable to parameter of type 'PageRef'.` |
| **Spelling quick fixes** | `info.titel` → *Change spelling to 'title'* |
| **Hover** with the resolved type and documentation | hover `names` → `const names: string[]` |
| **Syntax highlighting** for custom fence names, matching the theme's normal TS/JS colours | `km-ts` looks like a `ts` block |
| **JavaScript blocks** checked through JSDoc (`checkJs`) | `/** @type {number} */ let n = 1; n = "x";` → error |
| **Isolation**: each block is its own module | two blocks may both declare `const x` |

Fences may sit at the top level or inside nested ordered/unordered lists, blockquotes and callouts. Only the code is analysed. The `> ` markers and list indentation are removed before analysis and are never underlined.

What it deliberately **doesn't** do: run your code automatically, work in Reading view, resolve `import`s or npm packages, offer refactors (rename, go-to-definition), or check inline code. See [Limitations](#limitations).

---

## Quick start

### 1. Install

```sh
pnpm add obsidian-typed-codeblocks
```

### 2. Register the extension in your plugin

```ts
import { Plugin } from "obsidian";
import { typedCodeBlocks } from "obsidian-typed-codeblocks";
import kmGlobals from "./generated/km-globals.d.ts?raw"; // any way of importing a file as a string

export default class KindModelPlugin extends Plugin {
  onload() {
    const typed = typedCodeBlocks({
      id: "kind-model",                         // unique per plugin
      fences: { "km-ts": "ts", "km-js": "js" }, // info string → language
      globals: { "/km-globals.d.ts": kmGlobals },
      wrap: "async-function",                   // allow top-level await / return in blocks
    });

    this.registerEditorExtension(typed.extension);
    this.register(() => typed.dispose());
  }
}
```

`?raw` is only an example. The library needs the declaration file's **text**. Use whatever your bundler offers, such as an esbuild text loader or a generated `export default "…"` module.

### 3. Keep the host-provided modules external

Obsidian supplies these modules at runtime. Mark them as externals in your plugin's bundler config. They are also this package's peer dependencies:

```js
// esbuild.config.mjs (excerpt)
external: [
  "obsidian",
  "@codemirror/autocomplete",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  // ...plus the rest of your existing list
],
```

> [!IMPORTANT]
> Don't use a wildcard such as `@lezer/*`. The JavaScript/TypeScript grammar (`@lezer/javascript`) is **not** provided by Obsidian. It must be bundled, and a wildcard external would leave it missing at runtime.

There is nothing else to configure. You don't need a worker loader, an extra file next to `main.js`, a CDN or network access. The TypeScript worker ships inside the library as a string and starts from a Blob URL.

### 4. Update at runtime (optional)

```ts
await typed.updateGlobals({ "/km-globals.d.ts": regenerated }); // replaces the whole set
typed.setEnabled(false);                                         // e.g. from a settings toggle
```

---

## Writing the declaration file

`globals` maps **virtual paths** to **declaration text**. It describes types only, never runtime values. Paths must be absolute POSIX paths that end in `.d.ts`, such as `/km-globals.d.ts` or `/types/query.d.ts`. Declaration files can reference each other with relative paths.

There are two valid forms.

**Script style.** The file has no top-level `import` or `export`, and everything is global:

```ts
// /km-globals.d.ts
interface PageInfo { name: string; title: string }
type PageRef = string & { readonly __pageRef: unique symbol };

interface Query<Used extends string = never> {
  where(expr: string): Omit<Query<Used | "where">, Used | "where">;
  sortBy(field: string): Omit<Query<Used | "sortBy">, Used | "sortBy">;
  limit(n: number): Omit<Query<Used | "limit">, Used | "limit">;
  run(): Promise<PageInfo[]>;
}

/** The Kind Model API. */
declare const km: {
  getPageInfo(ref: PageRef): PageInfo | undefined;
  query(): Query;
};
```

**Module style.** The file uses `export`, so globals need `declare global`:

```ts
// /km-globals.d.ts
export interface PageInfo { name: string; title: string }

declare global {
  const km: { getPageInfo(ref: string): PageInfo | undefined };
}
```

> [!NOTE]
> In a module-style file, `export interface Foo` alone does **not** make `Foo` visible to blocks. Anything the blocks use must be reachable from `declare global`.

The standard library defaults to **`es2022` only**. There is no DOM, no `console` and no Node. Blocks only see the globals you declare or opt into with `libs: ["es2022", "dom"]`. Lib types describe APIs. They don't polyfill an older runtime.

---

## Running blocks: `obsidian-typed-codeblocks/run`

The editor side only *checks* code. Running it stays with your plugin. A separate, lightweight entry point helps you run code under the **same rules the checker used**: the same wrapper and the same scoping, with type annotations removed.

```ts
import { runBlock } from "obsidian-typed-codeblocks/run";

const wrap = "async-function" as const; // use the SAME value as in typedCodeBlocks()

this.registerMarkdownCodeBlockProcessor("km-ts", async (source, el, ctx) => {
  try {
    const result = await runBlock(source, {
      lang: "ts",
      wrap,
      globals: { km: this.api, el, ctx },
    });
    // render `result` with your plugin's UI
  } catch (error) {
    // error carries 1-based line/column in the ORIGINAL block, and the original error as `cause`
    console.error(error);
  }
});
```

- `compileBlock(source, { lang, wrap })` synchronously returns a JavaScript **function body** that you can pass to `new Function`.
- `runBlock(source, { lang, wrap, globals })` always returns a `Promise`. Globals are bound as parameters of the generated function. Their names are validated as strict-mode identifiers and never interpolated into code unchecked. Your block's own declarations can shadow them, just as they shadow ambient declarations in the checker.
- `verifyGlobals` (opt-in) compares the top-level names declared in your `.d.ts` with the keys you inject and warns about mismatches. It is a best-effort development aid. When it cannot be sure, it says so.

`/run` uses a small synchronous type stripper (Sucrase-style) on the main thread. It never loads TypeScript, the worker, CodeMirror or Obsidian, so it is cheap to import in Reading-view code.

| `wrap` | What the checker sees | What `runBlock` resolves to |
|---|---|---|
| `"none"` *(default)* | The block as a standalone module. Top-level `return` and `await` are errors. | `undefined` |
| `"async-function"` | The block inside `(async () => { … })();`. | The block's `return` value |
| `{ prefix, suffix }` | Your literal text around the block. It must be valid module text. | `undefined` |

> [!CAUTION]
> `runBlock` runs code **with the full privileges of Obsidian and your plugin**. Injected globals are a convenience, not a sandbox. It has no timeout and no cancellation, and synchronous loops can freeze the UI. A clean type check doesn't mean the code will succeed at runtime. The checker trusts your declarations to match the values you actually inject.

---

## API reference

```ts
type BlockLanguage = "ts" | "js";
type BlockWrap = "none" | "async-function" | { prefix: string; suffix: string };

interface TypedCodeBlocksOptions {
  id: string;                                   // [A-Za-z0-9][A-Za-z0-9_-]*, unique among live consumers
  fences: Record<string, BlockLanguage>;        // at least one; case-sensitive first word of the info string
  globals: Record<string, string>;              // virtual .d.ts path → declaration text
  wrap?: BlockWrap;                             // default "none"
  compilerOptions?: CompilerOptionsSubset;      // booleans only; see below
  libs?: Array<"es2022" | "es2023" | "es2024" | "dom">; // default ["es2022"]
  ignoreDiagnostics?: number[];                 // TypeScript error codes to hide
  lintDelay?: number;                           // ms, default 300
  features?: { completion?: boolean; diagnostics?: boolean; hover?: boolean; highlight?: boolean }; // all default true
  mobile?: boolean;                             // default false: highlighting only on mobile
  onError?: (error: unknown) => void;           // config/worker failures; default console.error
}

interface TypedCodeBlocks {
  extension: Extension;                         // pass to this.registerEditorExtension()
  updateGlobals(files: Record<string, string>): Promise<void>;
  setEnabled(enabled: boolean): void;
  ready(): Promise<void>;
  dispose(): void;
}

function typedCodeBlocks(options: TypedCodeBlocksOptions): TypedCodeBlocks;
```

You never import TypeScript types to use this API.

### Options worth explaining

- **`compilerOptions`** accepts only these booleans: `strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters` and `skipLibCheck`. Everything else is fixed: `target: ES2022`, `module: ESNext`, `moduleDetection: force`, `allowJs`, `checkJs`, `noEmit`, `erasableSyntaxOnly`, `types: []`, and `strict` / `skipLibCheck` on by default. Isolation and module loading cannot be overridden.
- **`ignoreDiagnostics`** hides diagnostics by code. Each diagnostic's `source` is `"<id> ts(<code>)"`, for example `kind-model ts(2339)`. The library's own diagnostics (rejected `import`/`export`, JSX, top-level `await` without the async wrapper) use codes from a reserved range outside TypeScript's, so they can be ignored the same way.
- **`mobile`**: by default, Obsidian mobile gets highlighting only and never starts TypeScript. Set it to `true` to opt in to the full language service on mobile.

### Lifecycle

| Call | Behaviour |
|---|---|
| `typedCodeBlocks(opts)` | Validates and copies the options. Throws synchronously on invalid input or a duplicate `id`. **Starts nothing.** |
| *(first owned block appears in an editor)* | Starts the worker lazily. Until it is ready, features return nothing, then refresh by themselves. |
| `ready()` | Explicit warm-up, even without a block. Rejects if disabled, if all service features are off, or if mobile policy forbids it. |
| `updateGlobals(files)` | Replaces the **whole** map (omitted files are deleted) and re-checks open editors. Resolves once the worker acknowledges. If the worker isn't running, it stores the map and resolves. |
| `setEnabled(false)` | Removes all UI, including highlighting, and stops the worker. Keeps the options, the latest globals and the fence claims. `true` rescans and restarts lazily. |
| `dispose()` | Terminal and idempotent. Stops the worker, rejects pending requests, releases fence claims, and makes attached editors inert at once. |

**Failures.** If the worker cannot be created, fails to initialise, or doesn't answer within a **fixed 30-second timeout**, pending promises reject and `onError` is called once per failure episode. The editor keeps working with highlighting. There is no automatic restart loop: toggle `setEnabled(false)` / `setEnabled(true)` to retry. TypeScript never falls back to running on the main thread. Exceptionally expensive type queries can hit the 30-second limit.

---

## Supported TypeScript

TypeScript blocks accept **erasable syntax only**. These are the constructs that disappear when you delete the type annotations. The editor checks with `erasableSyntaxOnly: true`, and the run helper rejects the same set, so the two always agree:

| Rejected in blocks | Use instead |
|---|---|
| `enum`, `const enum` | an `as const` object plus a union type |
| `namespace` containing runtime code | a plain object |
| constructor parameter properties (`constructor(private x: number)`) | explicit field assignments |
| `import x = require(...)`, `export =` | — |

Ambient declarations in your `.d.ts` files, such as `declare enum`, remain allowed.

Each block is also self-contained. `import`, `export`, dynamic `import()` and JSX/TSX get clear diagnostics, and blocks never see each other's variables.

---

## Living with other plugins

### Autocompletion must not use `override`

CodeMirror's `autocompletion({ override: [...] })` is all-or-nothing. If **any** plugin in the editor sets it, CodeMirror ignores every completion source registered through language data, and this library uses language data. To coexist, register your own completion sources like this:

```ts
// ✗ hides every other plugin's completions, including this library's
autocompletion({ override: [mySource] });

// ✓ cooperates
EditorState.languageData.of(() => [{ autocomplete: mySource }]);
```

The primary consumer, `obsidian-kind-model`, currently uses `override` for its `km` completions. Adopting this library there includes that migration. If an unrelated plugin installs an override, this library cannot work around it.

### Several plugins using this library

Each plugin bundles its own copy. The copies coordinate through a small versioned registry on `globalThis`:

- **Consumer ids are unique.** A duplicate live `id` throws.
- **The first claimant owns a fence.** If two plugins claim `km-ts`, the second logs a warning and skips that fence but keeps its others. When the owner is disposed, waiting consumers take over in registration order.
- **Each plugin runs its own worker.** Workers are never shared, so memory and cold start scale with the number of consumers.

### Claiming generic names like `ts` or `dataviewjs`

This is allowed, but be careful. Every such block in an **open editor** is checked against *your* globals. Blocks written for other purposes will show errors that look wrong to their authors. The vault is never scanned.

---

## How it works

```text
Main thread (each Obsidian editor)                   Web Worker (one per consuming plugin)
┌──────────────────────────────────────────┐          ┌───────────────────────────────────┐
│ fence scanner   → owned block ranges     │          │ TypeScript 6.x language service   │
│ prefix mapper   → strips > / list indent │   RPC    │  bundled lib .d.ts                │
│ position maps   ↔ note ⇄ virtual file    │ ───────▶ │  your globals (.d.ts)             │
│ highlighter     (Lezer, no TS needed)    │ ◀─────── │  one virtual file per block       │
│ completion · linter · hover · quick fix  │          │  (/<id>/blocks/<editor>/<blk>.ts) │
└──────────────────────────────────────────┘          └───────────────────────────────────┘
```

1. **Find blocks.** An incremental scanner follows CommonMark's rules for fences, lists, blockquotes and callouts. It tracks *every* fence, including ones it doesn't own, so an example nested in a longer outer fence isn't mistaken for a live block. It doesn't rely on Obsidian's internal syntax-tree node names. Notes without typed blocks never start TypeScript.
2. **Extract and map.** Each block's code, without container prefixes and with the chosen wrapper, becomes a virtual file. A two-way UTF-16 offset map translates positions between the note and that file. Errors in wrapper text are suppressed, and errors that span lines skip the `> ` prefixes. An edit is applied only when it maps exactly onto real code.
3. **Ask TypeScript.** Requests go to a worker over a versioned protocol. Every reply carries the block identity, the content version and the globals revision. A reply that no longer matches is discarded, so you never see a hover for code you have already changed.
4. **Show results** through CodeMirror's standard extension points: a language-data completion source, `linter`, `hoverTooltip` and lint actions. Other plugins' completions and diagnostics keep working.

Highlighting for custom fences uses the Lezer JavaScript/TypeScript parser on the main thread and maps tokens to the theme's existing CSS classes. It works before TypeScript has loaded, or without it.

---

## Performance and bundle size

The worker inlines TypeScript and its standard-library declarations, so the cost is real:

| Measure (one sample, Obsidian desktop 1.15.1 on macOS; not a p95) | Value |
|---|---|
| Root bundle (`dist/index.cjs`), including the worker string | ≈ 6.5 MB (worker ≈ 1.44 MB gzipped) |
| `require()` of the bundle in Obsidian | ≈ 26 ms |
| Worker cold start (`new Worker` → ready) | ≈ 1.3 s |
| First hover query | ≈ 90 ms |

These figures come from the [Phase 1 Blob-worker spike](docs/spikes/S1.md) with a trivial block. Phase 8 will replace them with a representative sample: a block of 300 lines or fewer, with a globals file of 5k lines or fewer.

Design targets (desktop, warm): under 2 ms added per keystroke on the main thread, completions under 100 ms, and diagnostics under 150 ms after the lint delay.

---

## Limitations

1. **Type quality equals declaration quality.** If your API returns `any`, nothing is checked.
2. **Editing view only.** Reading view gets no squiggles or hover. In Live Preview, if your plugin renders the block when the cursor is outside it, diagnostics show only while the block is being edited.
3. **Isolated blocks:** no shared variables, no imports, no npm types.
4. **Type-level checks only.** The contents of strings, such as query DSLs, aren't verified.
5. **Bundle size.** The bundle carries all of TypeScript. Loading it costs something even when no worker ever starts.
6. **Heavy type-level code** is as slow as in VS Code and can hit "excessively deep" errors.
7. **One worker per consuming plugin.**
8. **Single-line edits only in v1** for completions and quick fixes. Multi-line insertions inside callouts would need container prefixes re-inserted.
9. **TypeScript 6.x** is bundled. TypeScript 7's native compiler has no embeddable JavaScript API, so 7.x-only behaviour isn't reflected.
10. **The run helper doesn't type-check, sandbox, cancel or time-limit** code.
11. **Erasable syntax only.** See [Supported TypeScript](#supported-typescript).

---

## Developing this repository

Requires Node ≥ 22.18 and pnpm 10.

```sh
just install       # pnpm install --frozen-lockfile
just build         # two-stage build: worker bundle → inlined string → root + /run entries
just test          # build, then Vitest (unit + DOM projects)
just lint          # ESLint + tsc --noEmit
just check-graph   # assert bundle boundaries (root has no stripper; /run has no TS/worker/CM6/Obsidian)
just ci            # everything CI runs
```

The tests run against the **built** artefacts, because the inlined worker is part of what is under test.

| Path | Contents |
|---|---|
| `src/scanner`, `src/mapping` | Pure fence scanner, prefix mapper and position maps (no DOM, no CM6) |
| `src/worker` | Worker entry, protocol and Blob-URL spawning |
| `src/cm`, `src/highlight` | CodeMirror integration and the Lezer highlighter |
| `src/options`, `src/registry` | Option validation and the cross-bundle registry |
| `src/run` | The `/run` entry point |
| `scripts/` | Build, lib-closure extraction and dependency-graph checks |
| `examples/fixture-vault` | Markdown fixtures for manual checks in Obsidian (callouts, lists, tabs, …) |
| `features/2026-11-13-typed-codeblocks/` | Spec, plan and implementation log |
| `docs/` | Spike reports and, later, acceptance and FR-coverage records |

**Build note.** Obsidian desktop workers expose Node globals (`process`, `require`). These would push TypeScript onto its Node code path and crash it. The worker build therefore compiles `process` to `undefined`, and a regression test guards this. See [S1](docs/spikes/S1.md).

---

## Licences

This package is MIT-licensed. Its bundled output includes third-party code under the licences below. Their notices are kept in the distributed files:

- **TypeScript** and its standard-library declaration files: Apache-2.0
- **@typescript/vfs**: MIT
- **@lezer/javascript** grammar: MIT
- The type-stripping transformer used by `/run`: see its notice in `dist/run.*`
