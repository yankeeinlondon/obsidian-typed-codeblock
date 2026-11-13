---
$schema:
    status: |-
        enum(
            draft-spec,
            finalized-spec,
            planned,
            implemented,
            review-findings,
            human-in-the-loop,
            completed,
            on-hold,
            abandoned
        ) -> an indicator of progress for this specification
    reviewed: boolean -> indicates whether the specification file has been reviewed by another agent from the one which created the spec
    reviewed_by: string -> the agent and model used in the spec review
    reviewed_on: date -> the date the spec was reviewed
    review_iterations: number -> the number of implementation reviews have taken place in the review/fix cycle
    clarified: boolean -> indicates whether the specification was built -- _in part_ -- with the 'clarify.md' prompt
    implemented: boolean -> indicates whether this spec's plan has been implemented
    implemented_by: string -> the agent who implemented the plan
status: planned
reviewed: true
reviewed_by: codex/gpt-6.1-sol
reviewed_on: 2026-11-13
review_iterations: 0
needs_rulings: false
---

# Typed Code Blocks: Specification

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
6. No TypeScript execution or worker startup for notes without typed fences. Fence detection still has a small, bounded editor cost; TypeScript is initialized lazily in the worker.
7. A small, stable consumer API; consumers never touch TypeScript or worker plumbing.

## 3. Non-goals

- **Owning execution.** Deciding when and where a block runs, and rendering its output, stays with the consuming plugin. The library provides an optional `obsidian-typed-codeblocks/run` helper (§5.9) to align source wrapping and supported type transformation with execution; it does not guarantee runtime success.
- Reading view features (highlighting/diagnostics in rendered output).
- npm package resolution / automatic type acquisition, `import` of external modules.
- IDE refactors: rename, extract, organise imports, go-to-definition.
- Inferring types from vault content (frontmatter schemas etc.). Consumers may generate such types and pass them as globals.
- Sharing a TypeScript worker between consuming plugins.
- Typing inline code (`` `$= …` ``) or code outside fenced blocks.

## 4. Consumer experience

### 4.1 Registration

```ts
import { Plugin } from "obsidian";
import { typedCodeBlocks } from "obsidian-typed-codeblocks";
import kmGlobals from "./generated/km-globals.d.ts?raw"; // example bundler-specific raw-text import

export default class KindModelPlugin extends Plugin {
  onload() {
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

The raw-text import is illustrative: the consumer build must turn its declaration file into a string, using its existing loader or a generated string module. The library does not require `?raw` support.

### 4.2 Runtime updates

```ts
await typed.updateGlobals({ "/km-globals.d.ts": regenerated }); // replaces declarations; schedules checks in open editors
typed.setEnabled(false);                                         // e.g. from a settings toggle
```

### 4.3 What the author sees

Assume the consumer supplies a nonnumeric `PageRef` type, complete declarations for `PageInfo` with string `name` and `title` fields, and a known `info: PageInfo` binding for the spelling example. It also declares:

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
| Hover | pointer rests over an identifier | resolved type + documentation when TypeScript supplies it |
| Multiple blocks | two `km-ts` blocks in a note | each checked independently, both see the globals |
| Non-erasable syntax | `enum Size { S, M, L }` in `km-ts` | squiggle: `This syntax is not allowed when 'erasableSyntaxOnly' is enabled.` (§5.10) |

## 5. Functional requirements

### 5.1 Fence detection

- **FR-1** Recognise fenced blocks whose info string's first word matches a key of `fences` (case-sensitive). Backtick and tilde fences follow [CommonMark fenced-block rules](https://spec.commonmark.org/0.31.2/#fenced-code-blocks): at least three matching fence characters, a closing fence at least as long as the opener, and no trailing closing-fence text except spaces or tabs. A backtick opener's info string cannot contain backticks. Remaining info-string words do not affect typing.
- **FR-2** Support unordered and ordered list items, including nested lists. After container indentation is accounted for, opening and closing fences may have up to three spaces of indentation. Content loses at most the opener's additional indentation; code indentation is preserved. Tabs use Markdown's four-column stops when interpreting containers, and remain literal characters in code where possible.
- **FR-3** Support callouts/blockquotes, nested quotes, and lists mixed with quotes. A shared per-line **prefix mapper** removes only the markers and indentation belonging to the enclosing containers. It must not strip a code operator such as `>` or arbitrary leading whitespace. A quote marker consumes its optional following separator, not every space after it. Fenced content has no lazy quote continuation: losing a required enclosing quote marker ends that block.
- **FR-4** An unclosed fence extends to the end of its enclosing container, or to the end of the document for a top-level fence. Opening/closing fence lines, callout headers, and content after a container ends are never code. Empty blocks are supported, including insertion at their empty content boundary.
- **FR-5** Detection uses an incremental text scanner, independent of Obsidian's undocumented syntax-tree node names. Track Markdown container state and **all** fences, including unowned ones, so examples inside a longer outer fence are not mistaken for typed blocks. Exclude YAML frontmatter, HTML blocks, and indented code where a fence is literal text. Store ranges and scan checkpoints in a pure `StateField`; resume from a valid checkpoint before the earliest change and continue until both structure and unchanged text agree with cached state, or reach the document end. Merely starting at the changed line without its previous state is insufficient. One full initial scan is allowed; a delimiter edit may legitimately invalidate the rest of the note.

Obsidian-specific callout examples must be checked in the fixture vault; any deliberate deviation from CommonMark must be documented with an example and its expected extracted text.

### 5.2 Virtual files and position mapping

- **FR-6** Each block maps to `/<consumerId>/blocks/<editorId>/<blockId>.<ts|js>`, with stable, opaque block identities rather than the block's current ordinal. Separate editors of the same note have independent files. Block files never share scope (`moduleDetection: force`); all see the consumer's declaration files. Deleting a block invalidates its identity; late replies must never target a newly created block at the same position.
- **FR-7** `wrap` defaults to `"none"` and accepts:
  - `"none"`: the block is the file verbatim; top-level `return` is invalid, and top-level `await` is not supported by the execution helper;
  - `"async-function"`: `(async () => {\n` + block + `\n})();`, permitting block-level `await` and `return`;
  - `{ prefix, suffix }`: literal strings around the block. Consumers supply any separators/newlines needed to form valid syntax. The wrapper must be valid in a TypeScript module; a top-level function-body `return` in its prefix is not valid editor syntax.
- **FR-8** A bidirectional map uses zero-based UTF-16 offsets, as CodeMirror and TypeScript do. It accounts for wrapper text, container prefixes, indentation removed from code, and any synthetic whitespace needed for partially consumed tabs. Document positions in fence lines or stripped prefixes return no code position. Virtual positions in generated text return no document position. Diagnostic and hover spans intersecting real code are clipped to that code; diagnostics wholly in generated text are suppressed. A multi-line diagnostic is split as needed to avoid marking container prefixes. Edits require an exact, contiguous mapping and must never be clamped. Round trips are required for retained code positions and explicit insertion boundaries, not removed or generated characters. Test Unicode, tabs, empty/final lines, and line-ending normalization.
- **FR-9** Create, update, and delete virtual files as blocks change. Remove all of an editor's files when its view is destroyed or changes to a different document. An ordinary edit before a surviving block preserves its identity while updating its position map. A wrapper or language change invalidates that block's pending queries. All operations use the current extraction map, never note paths or stale ordinals.

### 5.3 Completion

- **FR-10** Completions come from `getCompletionsAtPosition` + `getCompletionEntryDetails` (lazy `info`), mapped to CM6 `Completion` types (property, method, function, variable, constant, class, type, keyword). Respect TypeScript replacement spans and `insertText`. v1 offers plain, single-line insertions only; exclude snippet entries and entries requiring imports or auxiliary edits. Do not turn snippet placeholders into literal inserted text.
- **FR-11** Contribute an `autocomplete` source with `EditorState.languageData`, returning it only inside an owned typed block, without replacing Markdown language data. Never set `autocompletion({ override })` or install a new top-level language. Preserve other sources and host key bindings. If another plugin has already installed an exclusive completion override, document that limitation; this library cannot make that override consult language data.
- **FR-11a** CodeMirror does not merge `override` across `autocompletion()` configurations: any `override` in an editor bypasses every language-data source. The primary consumer, kind-model, currently registers its `km` completions with `autocompletion({ override: [...] })` (`src/utils/language/autocomplete.ts`), so in a vault with kind-model loaded this library's completions would never run. Integrating kind-model therefore includes migrating its `km` completion source to `EditorState.languageData`. The README's consumer guide states the same requirement for any plugin that wants to coexist.
- **FR-12** Triggers: identifier characters and `.`; explicit trigger through the host's completion command (commonly Ctrl-Space). Use `validFor` only while the same identifier, block, and globals revision remain valid. Member access, punctuation, ownership changes, and declaration updates invalidate the result. Ordinary string/comment positions return nothing unless TypeScript supplies an appropriate completion.
- **FR-13** Async completions and lazy details honour `CompletionContext.aborted`; completion, hover, diagnostics, and edit actions all discard stale responses using the revision rules in §7.2. Every accepted edit stays within the originating block and is one undoable transaction.

### 5.4 Diagnostics

- **FR-14** Syntactic + semantic diagnostics per block via a CM6 `linter` (300 ms default requested delay, configurable). Map errors to `error`, warnings to `warning`, suggestions to `hint`, and messages to `info`; flatten nested message text. Use `source: "<id> ts(<code>)"`. CodeMirror combines linter configuration, so the effective delay may also depend on other installed linters. Never publish results through a separate `setDiagnostics` call that overwrites their results.
- **FR-15** Suppress diagnostics located wholly in wrapper text. Keep code-local errors even if wrapping influences their meaning; suppressing every error that might be wrapper-related would hide real failures. Consumers can suppress TypeScript codes via `ignoreDiagnostics: number[]`. Configuration and declaration-file failures go to `onError`, with their virtual path and available location, rather than being placed on unrelated note text.
- **FR-16** Quick fixes: offer TypeScript spelling fixes (`getCodeFixesAtPosition`, fix name `fixSpelling`) as diagnostic actions. Apply only single-line replacements entirely within the same current block; reject changes to declarations, wrappers, other files, or container markers. Revalidate the block text and globals revision at action time. Other code fixes and multi-line insertions are out of scope for v1.
- **FR-17** Diagnostics are emitted only inside owned typed blocks. A library state effect and the linter's `needsRefresh` hook trigger fresh checks after worker readiness, `updateGlobals`, enablement, or ownership changes, even without a document edit. While disabled, disposed, or failed, the library's linter returns no diagnostics; other lint sources remain active.

### 5.5 Hover

- **FR-18** `hoverTooltip` using `getQuickInfoAtPosition`: type signature (monospace, highlighted), JSDoc text, and `@param`/`@returns` tags. Render documentation and completion details as text or sanitized structured content; never insert declaration or note text as raw HTML. Hover returns nothing outside mapped code or after its originating revision changes.

### 5.6 Highlighting

- **FR-19** For standard TypeScript/JavaScript aliases (`ts`, `typescript`, `js`, `javascript`), defer highlighting to Obsidian. Other names use the custom-fence highlighter when enabled; no dependency on undocumented host language lookup is required.
- **FR-20** For custom fence names (e.g. `km-ts`), parse extracted code with the Lezer TypeScript/JavaScript parser and emit token marks mapped only onto code. Cache parsing per changed block and emit decorations for visible content; scrolling does not reparse unchanged blocks. Map token categories to the host's existing theme classes through a small, isolated adapter. Exact classes are an Obsidian compatibility detail, verified in the supported release. Do not replace or reveal content hidden by Live Preview decorations. **Acceptance:** representative comments, strings, keywords, numbers, types, and members match the equivalent standard-language block under the default theme and one named community theme recorded with its version; no duplicate token styling or marks on container prefixes.
- **FR-21** Highlighting doesn't depend on TypeScript having loaded.

### 5.7 Lifecycle and loading

- **FR-22** Start one lazy worker only when an enabled consumer has an owned typed block in an attached editor and at least one of completion, diagnostics, or hover is enabled. Highlight-only mode never starts it. Before readiness, these features return nothing and refresh when initialization completes. Calling `ready()` is an explicit opt-in to warm-up even without a block, subject to mobile/disabled restrictions (§6).
- **FR-23** Create the Web Worker from a self-contained inlined source string using a Blob URL. No consumer worker-loader setup, extra deployed file, dynamic chunk, CDN, or network fetch is required. The string is bundled in `main.js`, so plugin loading still reads it and may allocate it; only compilation/execution of TypeScript and service initialization are deferred. Do not describe this as zero bundle-loading cost. Revoke the Blob URL after worker startup, or on failure/disposal.
- **FR-24** `dispose()` is terminal and idempotent: terminate the worker, reject outstanding requests, release registry claims, cancel timers, and clear editor caches and this consumer's UI. `setEnabled(false)` temporarily removes all this library's UI, terminates its worker, and retains options and the latest declarations; it keeps its fence claims until disposal. Re-enabling rescans attached editors and starts lazily again. Changes to attached views are dispatched outside CM6 update callbacks. Closing the final typed editor removes its files; an already-warm worker may remain until disablement/disposal.
- **FR-24a** Worker construction errors, failed initialization, incompatible protocol, and fatal worker errors reject affected promises and invoke `onError` once per failure episode. The editor stays usable with highlighting. No infinite automatic restart loop: disable/re-enable explicitly retries. A worker that never acknowledges startup or a request fails after a 30-second timeout; document this fixed v1 limit, including that exceptionally expensive type queries may trigger it. Do not route TypeScript onto the main thread as a fallback. Protocol errors are separate from ordinary code diagnostics.
- **FR-25** `mobile` defaults to `false`: on Obsidian mobile, only highlighting is active unless opted in. With `mobile: true`, use the same worker implementation; failure follows FR-24a. The run helper is independent and only runs when a consumer explicitly calls it.

### 5.8 Multiple consumers

- **FR-26** A global registry (`globalThis.__typedCodeBlocks`) stores an explicit registry format version, unique live consumer ids, and fence ownership across separately bundled copies of the library. Validate options before acquiring claims. Duplicate live ids throw synchronously. For a conflicting fence, the first claimant retains ownership and the later consumer logs a warning and skips that fence; it can still attach to its other fences. All features, including highlighting, obey the same ownership result.
- **FR-26a** Any fence name may be claimed, including generic language names (`ts`, `js`, `typescript`, …) and other plugins' fences (`dataviewjs`). Warn in the README that a generic name checks every such block in **open editors**, using that consumer's globals; it does not scan the vault. The registry coordinates this library's consumers only and cannot displace or coordinate unrelated plugins.
- **FR-26b** Disposal releases claims. Waiting enabled consumers retry conflicting fences in registration order and refresh attached editors when ownership changes. Disabling alone does not transfer claims. If an existing registry has an unsupported format, throw a descriptive initialization error rather than silently creating a competing registry or overwriting it. A consumer with no accepted fences remains inert unless it explicitly calls `ready()`.
- **FR-27** Each consumer runs its own worker; workers are never shared. Duplicate TypeScript instances are accepted and documented. Editors attached to one consumer share its worker and declarations, while preserving independent block files.
- **FR-27a** Worker messages carry `protocolVersion`, consumer/session identity, and file/global revisions (§7.2). Namespaces protect file identity; they do not imply future worker sharing.

### 5.9 Run helper (`obsidian-typed-codeblocks/run`)

Rationale: the checker sees extracted source with the selected wrapper and declared globals. Running raw TypeScript or dropping the wrapper can fail even when checking succeeds. The separate helper shares the wrapping contract and removes supported type syntax; it cannot prove that runtime values match their declarations. Supported TypeScript is **erasable syntax only** (decision Q6): constructs that need generated JavaScript are rejected by both the editor and the helper.

- **FR-28** Publish a separate entry point `obsidian-typed-codeblocks/run`. The main entry does not include the stripper or evaluator. The run entry does not include TypeScript, the worker string, Obsidian, or CM6. Only small dependency-free option/wrapping utilities are shared.
- **FR-29** `compileBlock(source, { lang, wrap })` synchronously returns a JavaScript **function body**, suitable for `new Function`, not a standalone module or expression. Input is extracted code only, without fences or container prefixes, as supplied to an Obsidian code-block processor. Apply the logical wrapper before type transformation so that block-level `await`/`return` parse in the intended context. Do not downlevel ordinary JavaScript; target runtime support is the consumer's responsibility. Static/dynamic imports, exports, JSX/TSX, and top-level `await` with `wrap: "none"` are rejected with a source location by both the editor integration and helper. Runtime syntax restrictions must be detected by parsing, not a keyword regex that would reject comments or strings.
- **FR-30** `runBlock(source, { lang, wrap, globals })` always returns `Promise<unknown>`, rejecting compilation errors, synchronous exceptions, or rejected async work returned by the wrapper. Bind own enumerable globals through validated function parameters; keys must be distinct valid strict-mode binding identifiers, excluding reserved words, `eval`, and `arguments`. Never interpolate unvalidated names into generated code. Preserve a separate inner scope so source declarations can shadow injected names just as block-local declarations shadow ambient declarations in the checker. Run in strict mode. The helper does not capture the value of a trailing expression.

| Wrap | Checker context | Runtime result |
|---|---|---|
| `"none"` | Isolated module, no block-level `return` | Statements execute in an inner scope; result is `undefined` |
| `"async-function"` | Async arrow-function body | Return the async invocation's promise from the generated outer function; `return 42` in the block resolves to `42`, no return resolves to `undefined` |
| Custom prefix/suffix | Literal wrapper as valid module text | Execute those statements in an inner scope; result is `undefined`. No implicit expression-value extraction or extra top-level `return` is supported |

Design note: evaluating `(async () => { ... })();` as an outer function's statement discards its promise. The helper must explicitly return that invocation from its generated outer function. This evaluator-only return is not added to the editor's virtual module. The logical wrapper and block scope remain the same; generated evaluator framing is included in the source map.

- **FR-31** Use a synchronous lightweight transformation library (for example, Sucrase) on the main thread. Never initialize TypeScript or its worker for compilation or Reading view execution. Because only erasable syntax is accepted (Q6), transformation is type removal; the transformer must not emit code for enums, namespaces, or parameter properties, and must supply source mappings for transformed text; simple wrapper line subtraction is insufficient when type removal changes columns.
- **FR-32** `verifyGlobals?: string | Record<string, string>` is an opt-in, best-effort development warning. Scan supported top-level ambient `declare const|let|var|function` value names while respecting comments, strings, and nesting; ignore interfaces/type aliases. Compare those names with supplied own keys and warn once per distinct mismatch for a declaration/key set. Module-based `declare global`, merged namespaces, ambient classes/enums, and destructuring can make this scan inconclusive: explicitly report that limitation rather than claim full verification or report false missing keys from an incomplete scan. Verification does not check value types, and ordinary built-ins are not part of the injected-key comparison.
- **FR-33** Compose transformation maps and evaluator framing to expose original block locations as one-based line/column metadata on helper errors. Preserve the original error as `cause`, including non-Error thrown values. Runtime stack mapping is best effort because engines format stacks differently; never invent a location for a syntax error or a stack frame that cannot be mapped. Preserve the original stack for investigation. Do not claim to catch detached asynchronous work (for example, a timer callback after the block promise resolves).
- **FR-34** The helper accepts the same TypeScript subset as the editor: erasable syntax only (decision Q6). Before transforming, it rejects non-erasable constructs (non-ambient `enum` and `const enum`, namespaces/modules containing runtime code, constructor parameter properties, `import … =` aliases, `export =`) with an error naming the construct and its original location. Detection uses a syntax tree, never a keyword regex. The rejected set mirrors TypeScript's `erasableSyntaxOnly` check; a test fixture runs every construct through both the editor's checker and the helper and requires matching accept/reject results.
- **FR-35** The helper executes with the host application's privileges; injected globals are conveniences, not an isolation boundary. It never runs automatically, provides no timeout or cancellation, and can block the UI with synchronous code. The consuming plugin controls whether and when execution is appropriate, reports failures, and disposes resources created by the block.

```ts
import { runBlock } from "obsidian-typed-codeblocks/run";

// Use the same wrap value in typedCodeBlocks() and runBlock().
const wrap = "async-function" as const;
this.registerMarkdownCodeBlockProcessor("km-ts", async (source, el, ctx) => {
  try {
    const result = await runBlock(source, {
      lang: "ts",
      wrap,
      globals: { km: this.api, dv: getAPI(this.app), el, ctx },
    });
    // Render result using the consuming plugin's normal UI.
  } catch (error) {
    // Report the error using the consuming plugin's normal UI.
    console.error(error);
  }
});
```

### 5.10 Declaration files and supported language

- `globals` is a complete map of declaration-file paths to text, not runtime values. Use normalized absolute POSIX paths ending in `.d.ts`; reject backslashes, traversal segments, and reserved internal file paths. Internally put declarations below `/<consumerId>/globals/` and preserve relative paths. Script-style ambient declarations are global. An exported declaration file needs `declare global` to expose names to blocks; exporting an interface alone does not create a global. The README includes both forms.
- Relative references between supplied declaration files and their type-only dependencies are supported within the in-memory file set. No vault files, installed packages, remote URLs, or implicit ambient Node types are read. Missing referenced declarations are reported as configuration errors. Bundled standard libraries and supplied declarations are the only declaration sources.
- `updateGlobals(files)` replaces the whole map: omitted files are deleted. Copy input maps at the API boundary. Validate paths/values before changing state; serialize replacements in call order. Each successful replacement increments a consumer-wide globals revision and invalidates completions, details, hover, fixes, and diagnostics across all attached editors.
- Language-service initialization reports invalid compiler options, declaration syntax errors, and unresolved supplied dependencies through `onError` with paths/locations. Declaration semantic checking follows `skipLibCheck`; when it is enabled, authors remain responsible for semantic consistency of their declaration files. Do not turn a declaration diagnostic without a block location into a note squiggle.
- Each block is independent. Imports/exports in block source receive clear library diagnostics even if TypeScript could resolve a supplied ambient module. Workers never resolve other blocks as dependencies. Top-level `await` without the async wrapper is also diagnosed so editor acceptance matches the execution contract.
- TS blocks are checked with `erasableSyntaxOnly: true` (decision Q6), so enums, value namespaces, parameter properties and `import =` aliases get TypeScript's own diagnostic while typing. The option applies to block files; ambient declarations in supplied `.d.ts` files (e.g. `declare enum`) remain allowed. JS blocks cannot contain these constructs.
- The `libs` option supplies types only, never runtime APIs. The default `es2022` intentionally omits DOM, console, Obsidian, and Node globals; declare runtime globals explicitly or opt into `dom` where appropriate. Newer standard-library types do not polyfill older Obsidian engines.

## 6. Public API (v1)

```ts
import type { Extension } from "@codemirror/state";

export type BlockLanguage = "ts" | "js";
export type BlockWrap = "none" | "async-function" | { prefix: string; suffix: string };

// Consumer-facing booleans; no import of TypeScript enums or compiler types.
export interface CompilerOptionsSubset {
  strict?: boolean;
  noImplicitAny?: boolean;
  strictNullChecks?: boolean;
  noUncheckedIndexedAccess?: boolean;
  exactOptionalPropertyTypes?: boolean;
  noUnusedLocals?: boolean;
  noUnusedParameters?: boolean;
  skipLibCheck?: boolean;
}

export interface TypedCodeBlocksOptions {
  id: string;
  fences: Record<string, BlockLanguage>;
  globals: Record<string, string>;             // virtual path → .d.ts contents
  wrap?: BlockWrap;                           // default "none"
  compilerOptions?: CompilerOptionsSubset;    // merged over defaults (§7.3)
  libs?: Array<"es2022" | "es2023" | "es2024" | "dom">; // default ["es2022"]
  ignoreDiagnostics?: number[];
  lintDelay?: number;                         // default 300 ms
  features?: { completion?: boolean; diagnostics?: boolean; hover?: boolean; highlight?: boolean };
  mobile?: boolean;                           // default false
  onError?: (error: unknown) => void;          // configuration/worker failures; default console.error
}

export interface TypedCodeBlocks {
  extension: Extension;                       // pass to registerEditorExtension
  updateGlobals(files: Record<string, string>): Promise<void>;
  setEnabled(enabled: boolean): void;
  ready(): Promise<void>;
  dispose(): void;
}

export function typedCodeBlocks(options: TypedCodeBlocksOptions): TypedCodeBlocks;

// Exported from obsidian-typed-codeblocks/run, with the shared language/wrap types.
export interface CompileBlockOptions {
  lang: BlockLanguage;
  wrap?: BlockWrap;
}
export interface RunBlockOptions extends CompileBlockOptions {
  globals?: Record<string, unknown>;           // default {}
  verifyGlobals?: string | Record<string, string>;
}
export function compileBlock(source: string, options: CompileBlockOptions): string;
export function runBlock(source: string, options: RunBlockOptions): Promise<unknown>;
```

All feature flags default to `true`; `mobile: false` additionally disables the three language-service features on mobile. `setEnabled(false)` disables highlighting as well. Options are copied and validated at registration: invalid options throw synchronously before acquiring registry claims. An id is a nonempty ASCII string matching `[A-Za-z0-9][A-Za-z0-9_-]*`; a fence key is a nonempty single token without whitespace, backticks, or tildes. Require at least one fence, string declaration contents, known option keys/values, finite nonnegative `lintDelay`, and integer diagnostic codes. Reject compiler options outside the published subset; callers cannot override isolation, loading, module resolution, or emit controls.

`updateGlobals` resolves after an active worker acknowledges the replacement and editor refresh is scheduled, not after every diagnostic has completed. When disabled or not yet started, store the replacement and resolve without starting a worker. Validation failure leaves the previous map intact. A worker failure rejects the operation; retained latest declarations are used on an explicit retry. No partial worker state is queried after failure.

`ready()` explicitly warms the service and resolves after initialization with the latest accepted declarations. It rejects when disabled, when the three service features are all disabled, or when mobile policy prevents service use; it never waits indefinitely for a future fence or silently overrides policy. Concurrent calls share initialization. Calling it on a warm worker resolves immediately. A globals replacement arriving during initialization must be applied before readiness resolves.

After disposal, `setEnabled` throws; `ready` and `updateGlobals` reject; repeated `dispose` is harmless. Pending requests reject on disablement/disposal. Expected shutdown cancellation does not invoke `onError`. All currently attached editor extensions become inert immediately, even if Obsidian removes the registered extension later.

## 7. Architecture

### 7.1 Components

```
Main thread (per Obsidian editor)                     Worker (one per consumer)
┌──────────────────────────────────────────┐          ┌───────────────────────────────┐
│ fenceField (StateField: block ranges)    │          │ @typescript/vfs environment   │
│ highlighter (ViewPlugin, Lezer)          │  RPC     │  lib .d.ts (bundled)          │
│ syncPlugin (ViewPlugin → file updates)   │ ───────▶ │  consumer globals             │
│ completion source / linter / hover       │ ◀─────── │  isolated block virtual files │
│ position maps                            │          │ LanguageService queries       │
└──────────────────────────────────────────┘          └───────────────────────────────┘
```

### 7.2 Worker protocol

- Use structured-clone-safe request/response objects with request id, `protocolVersion`, consumer id, and worker-session generation. Serialize TypeScript completion details, documentation, diagnostics, and code fixes to plain data; do not send compiler objects, methods, or cyclic data. Errors use explicit error responses. Unknown requests/protocols fail descriptively.
- Operations: `init(globals, compilerOptions, libs)`, `setFiles(updates[])`, `deleteFiles(paths[])`, `completions(path, pos)`, `completionDetails(path, pos, name, source, data)`, `diagnostics(path)`, `quickInfo(path, pos)`, `codeFixes(path, start, end, codes)`, `updateGlobals(files)`.
- File updates carry a monotonically increasing content version. Every query and response identifies the block identity/version, globals revision, and worker session. A request is processed only after its required updates; discard responses if any revision or ownership no longer matches. This includes lazy completion details and deferred diagnostic actions. Reusing a file number or comparing only its local version is insufficient after deletion or restart.
- Before accepting a result, map through the current document's map for that same block/version. Editing prose before unchanged code may preserve its file version but changes its document offsets. Queries at obsolete cursor positions cannot reopen a stale hover or completion popup.
- Coalesce file updates per block within a maximum 50 ms window; a query flushes the latest needed update first. Coalesce queued diagnostics to the latest revision so a busy worker does not accumulate a request for every keystroke. Cancellation discards responses; v1 does not promise to interrupt a synchronous TypeScript query already executing in the worker.
- Initialization acknowledges only after bundled libs, declarations, and current live files are registered and the language service can answer. Worker failure/shutdown settles all pending requests and clears timers. A new worker generation receives a full current snapshot; messages from a terminated generation are ignored.

### 7.3 TypeScript configuration

- Bundle a tested **TypeScript 6.x** JavaScript implementation and its matching lib files, with the exact installed version in the lockfile. `typescript: "^6.0.0"` is a version constraint, not an npm alias; use a real alias only if build tooling must also depend on another TypeScript version. Do not use `latest`. The choice retains the embeddable JavaScript API rather than depending on TypeScript 7's native compiler ([TypeScript 6 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html), [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).
- Fixed defaults: `target: ES2022`, standard libs from `libs`, `strict: true`, `allowJs: true`, `checkJs: true`, `noEmit: true`, `module: ESNext`, `moduleDetection: Force`, `skipLibCheck: true`, `erasableSyntaxOnly: true`, `types: []`, and no automatic type acquisition. Merge only the published boolean subset over these defaults. Module isolation and `erasableSyntaxOnly` remain fixed even when strictness is relaxed; runtime evaluation stays strict.
- Default library selection is explicit: bundle the transitive `.d.ts` closure for each advertised `libs` value. The virtual host resolves only bundled libs and supplied declarations; it cannot read disk or fetch packages. Disallowed block imports are checked independently of `types: []`, which alone does not block module resolution.
- Module detection isolates ordinary block files while preserving global declarations in `.d.ts` files ([TypeScript module detection](https://www.typescriptlang.org/tsconfig/moduleDetection.html)). It does not make execution an actual module loader or supply ambient globals at runtime.

### 7.4 Packaging and compatibility

- Publish ESM and CJS builds plus declarations for the root and `/run` exports, with explicit package `exports` entries. Consumers can import the root using Obsidian's usual single-file CJS plugin build. Neither entry requires runtime chunk resolution.
- Externalize the host-provided packages actually used: `obsidian`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/autocomplete`, `@codemirror/lint`, and relevant `@lezer/common`, `@lezer/highlight`, `@lezer/lr` imports. Declare their supported ranges as peers and matching development dependencies. Follow the [official Obsidian sample plugin's explicit external list](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/esbuild.config.mjs); do not assume all `@codemirror/*` or `@lezer/*` packages are provided.
- Bundle the JavaScript/TypeScript grammar, for example `@lezer/javascript`, as an implementation dependency while keeping its host-provided Lezer dependencies external. A parser being in the `@lezer` namespace does not mean Obsidian exposes that module. Consumer build instructions list the exact external modules rather than a wildcard that leaves the grammar unavailable at runtime.
- `obsidian` is a runtime external as well as a type dependency: `Platform` detection is a runtime use. The `/run` entry has no Obsidian runtime dependency. Peer metadata for editor-only packages must not force the run-only entry to import them.
- No runtime Node built-ins, `require` of a local file, `importScripts` from a CDN, or DOM use in the worker. Production worker creation and both entry points must work offline from a consumer's built `main.js`.
- Before publishing, record the exact desktop/mobile Obsidian releases used for compatibility checks and set the advertised minimum from the APIs/dependency versions actually required. Avoid claiming support for every historical release. Verify production Blob-worker startup in desktop and opted-in mobile; mobile highlight-only acceptance does not prove mobile worker support. When the host blocks Blob workers, fail through FR-24a rather than change the deployment contract.
- Retain bundled third-party license notices for TypeScript, standard libs, grammar, and transformer as applicable.

## 8. Limitations (documented for consumers)

1. **Type quality equals declaration quality.** Untyped data (e.g. Dataview's `dv.pages()` returns `DataArray<any>` with an index signature) gets no checking.
2. Editing view only. In Live Preview, if a consumer renders the block when the cursor is outside it, the source and its diagnostics are visible only while editing the block.
3. Blocks are isolated: no shared variables between blocks, no imports, no npm types.
4. Type-level checks only: string contents (e.g. query DSLs) are not verified. Runtime injection and declaration correctness remain the consumer's responsibility; `verifyGlobals` offers limited name warnings, not a proof that values or types match (§5.9).
5. Bundle size includes TypeScript, standard libs, and worker source in the consumer's `main.js`; loading that bundle is not free even before worker startup. Report actual sizes and warm-up observations (§9).
6. Heavy type-level code (deep recursive conditional types) is as slow as in VS Code and can hit "excessively deep" errors.
7. One TypeScript instance (worker) per consuming plugin; memory and cold start scale with the number of consumers.
8. v1 completion and spelling actions produce only single-line changes and do not reinsert container prefixes for multi-line edits. Normal author editing remains controlled by Obsidian.
9. Bundled TypeScript is 6.x; behaviour that differs in 7.x won't be reflected.
10. The execution helper does not type-check, isolate, cancel, or impose a runtime limit on code. A clean editor check does not guarantee successful execution, correct injected values, or available runtime APIs.
11. TS blocks accept erasable syntax only: no enums, value namespaces, constructor parameter properties, or `import =` aliases. Use `as const` objects, plain objects and explicit field assignments instead.

## 9. Non-functional requirements

| Metric | Target (desktop, warm) |
|---|---|
| Keystroke latency added on the main thread | < 2 ms p95 |
| Completion response | < 100 ms p95 for blocks ≤ 300 lines with a ≤ 5k-line globals file |
| Diagnostics after the lint delay | < 150 ms p95 |
| Cold start (first typed block → first completion) | < 1.5 s |
| Notes with no typed blocks | no worker startup or TypeScript execution; bounded incremental fence detection only |
| Added bundle size | measured and reported in README; budget decided after the first build |

The timing figures above are design targets, not measured results or mandatory statistical gates for an initial spike. Use one desktop host and a quick sample of the representative block/declaration sizes already specified above; record the host, build, approximate cold/warm timings, and bundle size. Do not infer p95 compliance from a quick sample. No additional hosts, repeated benchmark campaigns, or performance matrix is required. If the sample exposes a material problem, describe it for an author decision before widening the measurement work. Mobile checks in §10 verify compatibility, not an additional performance workload.

The no-fence requirement concerns incremental editor work, not the cost of reading an inlined worker string from the plugin bundle. Avoid full-note copies and rescans on ordinary keystrokes. Correct rescanning after a structural Markdown change may extend to the document end; report that limitation rather than promise constant cost for every edit.

## 10. Testing

- **Unit (Vitest, no DOM):** scanner fixtures for owned and unowned outer fences, fence lengths/trailing text, nested ordered/unordered lists, callouts, container exit, indentation/tabs, frontmatter/HTML/indented code, and empty/unclosed blocks. Compare incremental scans with full scans after edits to delimiters and container boundaries. Test mapping round trips on retained positions, Unicode/line endings, clipping of display ranges, and rejection of unsafe edit ranges. Validate option/default handling.
- **Language-service integration (Vitest, Node):** execute the worker core directly for globals, generic/fluent narrowing, isolated TS and JS scopes, wrapper `await`/`return`, spelling fixes, declaration references, disallowed imports/exports, and declaration replacement/deletion. Verify default missing DOM/Node globals and compiler-option errors. These checks exercise semantics; they do not replace real Blob-worker startup checks.
- **CM6 state tests:** assert ranges and field-derived mappings after transactions, stale revisions, block deletion/recreation, and two editors of one note. Test registry conflicts between independently loaded package copies, duplicate ids, incompatible format, claim release, and disable/re-enable/dispose. Use a controllable worker transport for out-of-order replies, globals updates during startup, errors/timeouts, and cancellation.
- **View/browser tests:** viewport decorations and hidden Live Preview content, completion replacement spans, stale detail/hover/fix actions, UI refresh without document edits, and preserved diagnostics/completions from another source. Use a DOM-capable harness for ViewPlugins; plain `EditorState` cannot verify view-provided decorations or popup behavior.
- **Run-helper tests:** actual execution of `return 42` and rejected promises in async mode, `undefined` results in other modes, strict mode, local shadowing of injected values, invalid global names, unsupported syntax, and original error metadata after type removal changes columns. Ensure comment/string text does not trigger syntax bans. A shared fixture of erasable and non-erasable constructs must produce identical accept/reject results from the editor checker and the helper (FR-34).
- **Package/type checks:** public API examples compile without importing TypeScript types. Consumer fixture builds resolve root and `/run` in ESM/CJS. Inspect emitted dependency graphs to confirm root excludes the transformer and `/run` excludes TypeScript/worker/CM6/Obsidian. Offline production build exercises an actual Blob worker; no development-only file loading is allowed.
- **Manual / e2e:** a fixture vault and minimal consumer plugin in `examples/`, exercised in Obsidian desktop (Live Preview and Source) and mobile highlight-only mode. Verify opted-in mobile worker startup if full mobile support is advertised. Test alongside kind-model's `km` completion/linter when that external plugin is available; it is not present in this repository. A second local fixture consumer ensures coexistence can be verified independently. Record app/theme versions, including the named community theme used for highlighting acceptance.

## 11. Milestones

1. **M1 – Core:** incremental fence scanner, per-line prefix mapper (lists + callouts), position maps, worker + vfs, diagnostics, completion, hover for `ts` fences with `wrap: "none"`. Build lazy startup and revision tracking into this foundation so initial editor behavior is safe.
2. **M2 – Obsidian polish:** custom-fence highlighting, wrap modes, JS fences, lifecycle/error recovery, mobile option, registry and coexistence checks.
3. **M3 – Quality + run helper:** spelling quick fixes, `obsidian-typed-codeblocks/run` (§5.9), proportional performance sample (§9), example plugin, packaging verification and docs. Integration into kind-model is a consumer acceptance check requiring that external repository, including the FR-11a completion migration there; it is not a library source change in this repository.
4. **v2 candidates:** semantic highlighting (`getEncodedSemanticClassifications`), signature help, per-note globals helper.

## 12. Decisions

| # | Decision | Date |
|---|---|---|
| Q1 | Ship the run helper as a separate entry point in M3, with a synchronous lightweight stripper (§5.9) | 2026-11-13 |
| Q2 | Do not share workers between consumers; one worker per consuming plugin (FR-27) | 2026-11-13 |
| Q3 | Allow any fence name, including generic `ts`/`js`; documented warning only (FR-26a) | 2026-11-13 |
| Q4 | npm package name `obsidian-typed-codeblocks` (repo folder name unchanged) | 2026-11-13 |
| Q5 | Callout/blockquote support in M1 via the shared per-line prefix mapper; no "ignore block" fallback (FR-3) | 2026-11-13 |
| Q6 | TS blocks accept erasable syntax only: editor checks with `erasableSyntaxOnly`, run helper rejects the same constructs (FR-34, §5.10) | 2026-11-13 |

## 13. Contract references

These are external compatibility references; this repository has no pre-existing implementation contracts to override.

- [CommonMark fenced code blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks) and [container blocks](https://spec.commonmark.org/0.31.2/#container-blocks): boundaries and extraction; Obsidian callouts add fixture coverage.
- [CodeMirror completion source and result types](https://github.com/codemirror/autocomplete/blob/main/src/completion.ts) and [language-data source lookup](https://github.com/codemirror/autocomplete/blob/main/src/state.ts): additional sources, cancellation, replacement spans, and result reuse.
- [CodeMirror lint implementation](https://github.com/codemirror/lint/blob/main/src/lint.ts): merged lint sources/configuration and refresh after non-document changes.
- [Official Obsidian plugin build configuration](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/esbuild.config.mjs): explicit host-provided dependency boundaries.
- [TypeScript module detection](https://www.typescriptlang.org/tsconfig/moduleDetection.html) and [TypeScript 6 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html): isolated block files and the chosen embeddable compiler line.
