---
total_phases: 8
created: 2026-11-13
phase: 1
agent: claude/sonnet
yolo: true
---

# Typed Code Blocks: Implementation Plan

Source: `spec.md` (status `finalized-spec`, reviewed). Spec milestones M1–M3 map onto the phases below. FR numbers refer to the spec.

## Summary of Work and Definition of Done

### What is being built

The repo is empty (one commit, no `package.json`), so everything is greenfield. The deliverable is the npm package `obsidian-typed-codeblocks` with two entry points:

1. **Root entry** `typedCodeBlocks(options)`. It returns a CM6 `Extension` plus a control handle. Its parts are:
   - a pure incremental fence scanner (`StateField`) with a per-line container prefix mapper and bidirectional position maps;
   - a lazily started, Blob-URL Web Worker hosting TypeScript 6.x and `@typescript/vfs`, speaking a versioned RPC protocol;
   - CM6 completion (via `EditorState.languageData`), `linter`, `hoverTooltip`, and a Lezer-based highlighter;
   - a cross-bundle global registry for fence ownership;
   - lifecycle control: enable, disable, dispose, errors, mobile policy.
2. **`/run` entry** with `compileBlock` / `runBlock` / `verifyGlobals`. It uses a synchronous type stripper (Sucrase), an erasable-syntax check by syntax tree, and source-map composition. It has no TypeScript, CM6, Obsidian or worker dependency.

It also includes an `examples/` consumer plugin and fixture vault, a second fixture consumer for coexistence, and a README (consumer guide, limitations, build externals, measured sizes).

### Successful completion means

- All FR-1…FR-35 have at least one automated test, or an explicit manual acceptance record for items that need Obsidian (highlight theme parity, Blob worker on desktop and opted-in mobile, Live Preview behaviour).
- Unit, language-service, CM6 state, view/browser, run-helper and package tests pass in CI via `pnpm test`.
- Root bundle graph excludes Sucrase and the run-only code. `/run` graph excludes TypeScript, the worker string, CM6 and Obsidian.
- A production-built example plugin starts a Blob worker offline in Obsidian desktop and delivers all §4.3 scenarios.
- One desktop sample of timings and bundle size is recorded in the README (no p95 claims, per §9).
- The kind-model integration (FR-11a migration) is documented as an external consumer acceptance check, not implemented here.

### Conventions for all phases

- pnpm + TypeScript + Vitest (`describe`/`it`). Use `inferred-types` where narrow types help. Descriptive variable names.
- Tests cover runtime behaviour. Add type tests for the public API types (Phase 8 and where generic).
- **Waves** are sets of tasks that can run concurrently in separate subagents. Waves are numbered globally across the plan. A task marked `after Wave N` depends on it.
- A checkpoint box at each phase end must be checked before the next phase starts.

---

## Phase 1: Rulings, Spikes and Scaffold

Goal: settle open decisions, de-risk the three riskiest unknowns once, and create the build and test skeleton.

### Necessary Rules

The spec is marked `needs_rulings: false`, but the following gaps would otherwise be decided ad hoc by implementers. Each carries a **recommended ruling** to proceed with unless the author overrides it. Record the final ruling inline when confirmed.

1. **Build tooling.** Recommend `tsup` (esbuild) for ESM+CJS+d.ts, with a two-stage build: stage 1 bundles the worker to a string, stage 2 inlines it into the root entry (a generated string module). No `?raw` or loader requirement on consumers (FR-23).
2. **Empty `globals: {}`.** Spec requires "string declaration contents" and does not say a non-empty map is required. Recommend allowing `{}`. `updateGlobals({})` is the explicit way to delete everything.
3. **Explicit `null` for optional options** (`wrap`, `libs`, `lintDelay`, …). Recommend rejecting it with a located error; only an absent key (or `undefined`) means default.
4. **Registration-time wrapper validation.** For `{ prefix, suffix }`, validate only that both are strings. Do not parse them. A syntactically invalid wrapper surfaces as ordinary editor diagnostics and as a helper compile error (FR-7).
5. **Library diagnostic codes** for imports/exports, top-level `await` with `wrap: "none"`, and JSX. Recommend a reserved numeric range (e.g. `90001+`) with `source: "<id> ts(<code>)"`, so `ignoreDiagnostics` works uniformly. Document the range in the README.
6. **Parser for the `/run` erasable check (FR-34).** Sucrase exposes no syntax tree, TypeScript is excluded from `/run`, and Lezer is a CM6 external that `/run` must not import. Recommend bundling a small TS-capable parser (`@babel/parser` with the `typescript` plugin) inside `/run` only. Acceptance is the shared parity fixture (Phase 7). If bundle size is unacceptable, the fallback is an author decision.
7. **Scanner checkpoint granularity.** Recommend one checkpoint per line start holding the container stack and open-fence state, stored sparsely (every N lines plus every fence boundary). Rescans resume from the nearest checkpoint at or before the earliest change.
8. **Callout deviations from CommonMark (spec §5.1 last paragraph).** The deviations are decided by the Spike S2 fixture results. Each deviation is documented with an example and expected extracted text in `docs/scanner-fixtures.md`.
9. **Named community theme for FR-20 acceptance.** Recommend Minimal, with version recorded. Author confirms or substitutes.
10. **Minimum Obsidian version.** Derived from Spike S1/S2 and the API/dependency versions actually used; not assumed up front (§7.4).
11. **Wider performance measurement.** Per §9 only one desktop host and a quick sample are in scope. If the sample shows a material problem, it is reported to the author as a ruling before any wider measurement. No extra hosts or matrix are planned.
12. **Worker timeout (FR-24a).** Fixed 30 s, not configurable in v1. Confirm.

### Spikes (each runs once, before the work it informs)

- **S1 – Blob worker with TypeScript 6.x in Obsidian desktop** (informs Phase 4, 6, 8). One host, one run.
  - Build a throwaway plugin that inlines a worker string containing `typescript` + `@typescript/vfs` and the `es2022` lib closure.
  - Create the worker from a Blob URL inside Obsidian desktop and answer one `getQuickInfoAtPosition`.
  - Record: it starts or not, inlined-string size, rough cold start, and any CSP or Blob error. Mobile is not spiked; mobile worker verification happens once in Phase 8 acceptance.
- **S2 – Obsidian editor structure and host classes** (informs Phase 2, 6). One run in the fixture vault.
  - Dump how Obsidian Live Preview and Source mode represent fences in callouts, nested lists, and quotes (raw text vs syntax tree).
  - Capture the highlight classes Obsidian applies to a standard `ts` block under the default theme.
  - Capture the extracted-text cases that Obsidian treats differently from CommonMark (feeds ruling 8).
- **S3 – Completion integration** (informs Phase 5). One run.
  - Register an `EditorState.languageData` `autocomplete` source and confirm that Obsidian's own editor does not install an exclusive `override`. Confirm it fires inside a fence in Live Preview and Source mode.
  - Check kind-model's `override` conflict as documented in FR-11a (by reading its source if available, else documenting it as unverified).

Spikes produce `docs/spikes/S1.md`, `S2.md` and `S3.md` with raw findings and a "decision impact" line. They are not repeated in later phases.

### Tasks

#### Wave 1 (parallel)

- [x] **Scaffold repo**
  - `package.json` (name `obsidian-typed-codeblocks`, `exports` for `.` and `./run` with ESM+CJS+types, peers for host-provided packages with matching devDependencies), `tsconfig`, `vitest.config` (node + a DOM-capable project for ViewPlugin tests, e.g. happy-dom/jsdom), lint, `.gitignore`.
  - Pin `typescript` as `^6.0.0` with the exact version locked (not an alias, not `latest`).
  - `src/` layout: `scanner/`, `mapping/`, `options/`, `registry/`, `worker/`, `cm/`, `highlight/`, `run/`, `shared/`.
- [x] **Run spike S1** (after the scaffold's tooling exists; may start with a standalone dir). Write `docs/spikes/S1.md`.
- [ ] **Run spike S2.** Create `examples/fixture-vault/` with callout/list/quote/tab/frontmatter notes. Write `docs/spikes/S2.md`.
- [ ] **Run spike S3.** Write `docs/spikes/S3.md`.

#### Wave 2 (after Wave 1)

- [ ] **Record rulings**: update the Necessary Rules list above with the confirmed or overridden decision for each ruling, including the S1/S2/S3 outcomes.
- [ ] **Build pipeline**: two-stage build (worker→string module→root entry), externals list exactly per §7.4, separate `/run` build, dependency-graph check script (`pnpm check:graph`) that fails if the root includes Sucrase or `/run` includes TypeScript/CM6/obsidian.

### Checkpoint

- [ ] `pnpm build`, `pnpm test` (empty suite passes) and `pnpm check:graph` run green.
- [ ] S1 shows Blob worker starts in desktop Obsidian, or an author-facing note describes the failure before Phase 4 begins.
- [ ] All 12 rulings are recorded.

---

## Phase 2: Pure Core: Scanner, Prefix Mapper, Position Maps (M1)

Goal: framework-free, fully unit-tested extraction of typed blocks. No CM6 view, no worker.

### Tasks

#### Wave 3 (parallel; both depend only on Phase 1)

- [ ] **Line scanner core** (FR-1, FR-2, FR-4, FR-5)
  - Line-oriented state machine tracking container stack (list items with indentation, blockquotes/callouts), open fence (char, length, indent, owned or not), frontmatter, HTML blocks, indented code.
  - Tracks **all** fences, owned or unowned, so examples inside a longer outer fence are literal text.
  - CommonMark rules: ≥3 fence chars, closer ≥ opener, only spaces or tabs after the closer, backtick opener info string cannot contain backticks, first info word case-sensitive against `fences`.
  - Unclosed fence extends to the end of its container, or the document end.
- [ ] **Prefix mapper** (FR-3, FR-8)
  - Per-line removal of only the enclosing container markers and indentation. A quote marker consumes only its optional single separator. Code `>` and arbitrary leading whitespace are preserved.
  - Tab handling on four-column stops with synthetic whitespace for partially consumed tabs.
  - No lazy continuation inside fences: a missing required quote marker ends the block.
- [ ] **Position map** (FR-8)
  - Bidirectional UTF-16 maps doc↔virtual that account for wrapper text, prefixes, removed indentation and synthetic tab whitespace.
  - API: `toVirtual`, `toDoc` (returns `undefined` for fence lines, prefixes, generated text), `clipRange` for diagnostics/hover (split multi-line spans to avoid prefixes), and `exactEditRange` (no clamping; rejects non-contiguous).
  - Explicit insertion boundaries (including an empty block's content boundary).

#### Wave 4 (after Wave 3)

- [ ] **Incremental rescan** (FR-5)
  - Checkpoint storage and `rescan(prevState, changes, doc)`. It resumes from a valid checkpoint before the earliest change and continues until both structure and unchanged text agree with cached state, or the document ends.
  - Block identity: opaque stable ids that survive edits before a block, are invalidated on deletion, and are never reused (FR-6, FR-9).
- [ ] **Scanner fixture suite** (spec §10 Unit)
  - Owned vs unowned outer fences, fence lengths/trailing text, nested ordered/unordered lists, callouts, nested quotes, mixed list+quote, container exit, indentation/tabs, frontmatter/HTML/indented code, empty and unclosed blocks.
  - **Property test:** for random edits (including delimiter and container-boundary edits), incremental result equals a full scan.
- [ ] **Mapping test suite**: round trips on retained positions, Unicode (astral/surrogates), CRLF/LF normalisation, tabs, empty/final lines, clipping, and rejection of unsafe edit ranges.
- [ ] **Callout fixtures from S2** are encoded as tests; deviations are documented in `docs/scanner-fixtures.md` (ruling 8).

### Checkpoint

- [ ] Scanner, mapper and map suites green, including incremental==full property test.
- [ ] No imports of `obsidian`, DOM or CM6 view code in `src/scanner` and `src/mapping` (CM6 `Text`/`ChangeSet` types only).

---

## Phase 3: Options, Registry, Pure Contracts (M1/M2 foundations)

Goal: validated configuration and cross-bundle fence ownership, before anything runs.

### Input Robustness Matrix

The `typedCodeBlocks` options object, the `globals` map and the registry value are configuration readers. The consuming plugin passes plain JS objects, so there is no document-format loader and **no document-shape tests apply** (duplicate keys, trailing content, format syntax). Field shapes are tested at the validators below, through the public `typedCodeBlocks()` call and `updateGlobals()`.

**Default outcome (stated once):** every invalid shape throws synchronously (or rejects for `updateGlobals`) with an error naming the option/path. It acquires no registry claim, starts nothing and leaves previous state intact.

**Exceptions** (behave differently):

| Field | Shape | Outcome |
|---|---|---|
| `wrap`, `compilerOptions`, `libs`, `ignoreDiagnostics`, `lintDelay`, `features`, `mobile`, `onError` | absent | default applied |
| same optional fields | explicit `null` | error (ruling 3); never conflated with absent |
| `globals` | `{}` | allowed (ruling 2) |
| `ignoreDiagnostics` | `[]` | allowed no-op |
| `lintDelay` | `0` | allowed |
| `features` | `{}` | all four default `true` |
| `libs` | `[]` | error (a lib set must be non-empty) |
| `fences` | `{}` | error (at least one fence) |

**Validators and the shapes each walks** (walk once per validator, not per field):

- *String validator* (`id`, fence keys): absent, null, wrong type, empty, bad charset (`id` regex, fence key whitespace/backtick/tilde).
- *String-map validator* (`globals`, `updateGlobals` argument, `fences` values): absent, null, wrong type whole, one wrong-type value among strings, all values wrong type, empty map, bad key (path rules: absolute POSIX, `.d.ts`, no backslash, no traversal, no reserved internal path).
- *Array validator* (`libs`, `ignoreDiagnostics`): absent, null, whole wrong type, one wrong element, all wrong elements, empty. Elements: `libs` known values; `ignoreDiagnostics` integers.
- *Boolean-subset validator* (`compilerOptions`, `features`, `mobile`): wrong type, unknown key rejected, key outside the published subset (e.g. `module`, `noEmit`) rejected.
- *Number validator* (`lintDelay`): wrong type, NaN, ±Infinity, negative.
- *Wrap validator*: string other than the two literals, object missing `prefix` or `suffix`, non-string `prefix`/`suffix`, extra keys.
- *Registry reader* (`globalThis.__typedCodeBlocks`): absent → create; valid version → join; unsupported or non-object value → descriptive throw and no overwrite.

Each field sharing a validator gets one control case (valid) and one invalid shape to prove it is wired to that validator.

**Code-smell grep before closing the matrix** (record results in the PR): `#[serde(default)]`-style defaulting does not exist in TS, so grep instead for `?? default` / `|| default` applied to load-bearing option reads (these conflate null/absent/empty), `.filter(` on option arrays (silently drops wrong-typed elements), `Boolean(` or `!!` on option values, and `Object.assign`/spread of user options over defaults without validation.

### Tasks

#### Wave 5 (parallel)

- [ ] **Options validation** (§6)
  - Copy input at the boundary. Apply the validators above. Defaults per §6 and §7.3. Reject compiler options outside the published subset. Fixed isolation, module-resolution and emit options are not overridable.
  - Resolve the `{prefix,suffix}` wrapper into a normalized descriptor shared with `/run` (small dependency-free `src/shared/wrap.ts`).
- [ ] **Globals validation** (§5.10)
  - Path normalization and rules; the internal path layout `/<consumerId>/globals/…`, preserving relative paths.
  - Full-map replacement semantics (omitted files deleted), call-order serialization queue with revision counter, and "previous map intact on failure".
- [ ] **Global registry** (FR-26, FR-26a, FR-26b)
  - `globalThis.__typedCodeBlocks` with an explicit format version, unique live ids (synchronous throw on duplicates), first-claimant fence ownership, warn-and-skip for conflicts, release on dispose, and retry of waiting consumers in registration order with an ownership-change notification.
  - Disable does not release claims. A consumer with no accepted fences is inert unless it calls `ready()`.

#### Wave 6 (after Wave 5)

- [ ] **Validator tests**: matrix cells above, in-process through the public API (`typedCodeBlocks()` with options stubbed so no worker starts). Include a control row per validator, and one cell per sharing field.
- [ ] **Registry tests**: two independently loaded copies (simulated by separate module instances via `vi.resetModules`), duplicate ids, incompatible format version (no overwrite), claim release and waiter promotion, disable/re-enable keeps claims.
- [ ] **Smell grep** run and recorded.

### Checkpoint

- [ ] Matrix tests green; every validator has a control and an invalid case; no row's state is unreported.
- [ ] Registry tests pass for the cross-copy cases.

---

## Phase 4: Worker Core and Protocol (M1)

Goal: the TypeScript service runs headlessly in Node tests and as an inlined Blob worker, behind a versioned, revision-aware RPC.

### Tasks

#### Wave 7 (parallel)

- [ ] **Worker core** (`src/worker/core.ts`, environment-neutral)
  - `@typescript/vfs` environment with the bundled lib closure per `libs`, the consumer's globals, and block virtual files. Fixed compiler defaults per §7.3 merged with the boolean subset.
  - Operations: `init`, `setFiles`, `deleteFiles`, `completions`, `completionDetails`, `diagnostics`, `quickInfo`, `codeFixes`, `updateGlobals`.
  - Serializes completions, details, diagnostics and fixes to plain data (flatten message chains).
  - Library diagnostics for imports/exports, JSX and top-level `await` with `wrap: "none"` (ruling 5). No default DOM/Node globals.
  - Init reports invalid options, declaration syntax errors and unresolved supplied references with path and location.
- [ ] **Protocol and client** (`src/worker/protocol.ts`, `client.ts`)
  - Request/response envelope: id, `protocolVersion`, consumer id, session generation, file/global revisions.
  - Monotonic per-file content versions; queries processed only after their prerequisite updates.
  - 50 ms per-block update coalescing with query-triggered flush; diagnostics coalesced to the latest revision.
  - Startup and request timeout of 30 s; shutdown rejects all pending requests and clears timers; messages from a terminated generation are ignored; explicit error responses; unknown protocol or operation fails descriptively.
  - A controllable transport interface (in-memory for tests, `Worker` in production).
- [ ] **Worker bundling**: worker entry bundled to a self-contained string (no Node built-ins, `importScripts`, DOM). Root entry creates it via Blob URL and revokes the URL after startup, on failure and on disposal (FR-23).

#### Wave 8 (after Wave 7)

- [ ] **Language-service integration tests** (Node, worker core direct; spec §10): globals, generic and fluent narrowing (`Query<Used>` example from §4.3), isolated TS/JS scopes, wrapper `await`/`return`, spelling fix `fixSpelling`, declaration `/// <reference>` between supplied files, disallowed imports/exports, declaration replacement and deletion, missing DOM/Node globals, compiler-option errors, `erasableSyntaxOnly` enum diagnostic, `checkJs` JSDoc error in a JS block.
- [ ] **Client/protocol tests** with a controllable transport: out-of-order replies, stale revisions discarded, globals update during startup applied before readiness, timeout, shutdown settling, ignored old-generation messages.
- [ ] **Blob worker smoke test**: production build of the worker string started in a real Blob worker (browser harness, e.g. Vitest browser mode/Playwright), answering a quick-info query offline.

### Checkpoint

- [ ] Every §4.3 scenario except hover and highlight is demonstrated by a worker-core test.
- [ ] Blob worker smoke test passes from the production bundle.

---

## Phase 5: CM6 Integration: Fence Field, Sync, Completion, Diagnostics, Hover (M1)

Goal: the editor behaviours for `ts` fences with `wrap: "none"`, with lazy startup.

### Tasks

#### Wave 9

- [ ] **fenceField and sync plugin** (FR-5, FR-6, FR-9, FR-22)
  - Pure `StateField` holding blocks, ranges, checkpoints and editor id; `ViewPlugin` that diffs blocks into `setFiles`/`deleteFiles` outside CM6 update callbacks.
  - Per-editor `editorId` so two views of one note have independent files; removal of all files on view destroy or document change.
  - Lazy worker start only when an enabled consumer has an owned block and at least one service feature is on.

#### Wave 10 (parallel; all after Wave 9)

- [ ] **Completion source** (FR-10…FR-13)
  - `EditorState.languageData.of(...)` with `autocomplete`, active only inside owned blocks. No `autocompletion({override})` and no new top-level language.
  - Maps TS kinds to CM6 `Completion` types. Honors replacement spans and `insertText`. Drops snippet, import-requiring and auxiliary-edit entries. Lazy `info` via `completionDetails`, honoring `aborted`.
  - `validFor` is used only while the identifier, block and globals revision are unchanged.
  - Sanitized text/structured rendering, never raw HTML.
- [ ] **Diagnostics linter** (FR-14, FR-15, FR-17)
  - `linter()` with a configurable delay, severity mapping, `source: "<id> ts(<code>)"`, wrapper-only suppression, `ignoreDiagnostics`, and span clipping and splitting through the position map.
  - A library `StateEffect` plus `needsRefresh` for worker-ready, `updateGlobals`, enablement and ownership changes. No `setDiagnostics`.
  - Config/declaration errors go to `onError` with virtual path and location, never as squiggles on note text.
- [ ] **Hover** (FR-18): `hoverTooltip` over `getQuickInfoAtPosition`. Monospace highlighted signature, JSDoc and `@param`/`@returns`. Nothing outside mapped code or after a revision change. Text-only rendering.

#### Wave 11 (after Wave 10)

- [ ] **CM6 state tests** (spec §10): ranges and maps after transactions, stale revisions, deletion/recreation of a block at the same position (late reply must not target the new block), two editors of one note, preserved identity on edits before a block.
- [ ] **View/browser tests** in the DOM harness: completion replacement spans, stale detail/hover discard, refresh with no document edit, other lint and completion sources preserved.
- [ ] **Lazy-start test**: a note without typed blocks never creates a worker (spy on the worker factory), and a highlight-only config never creates one.

### Checkpoint

- [ ] M1 scenarios from §4.3 (completion, argument error, misspelling squiggle, inference hover, fluent narrowing/misuse) work in a DOM-harness editor with a real worker core.
- [ ] Manual smoke in the example editor (Phase 8 plugin stub) in Obsidian desktop, Source mode, for `ts` fences with `wrap: "none"`.

---

## Phase 6: Obsidian Polish: Highlighting, Wraps, JS, Lifecycle, Mobile (M2)

Goal: complete the editor feature set and make failure and lifecycle behaviour safe.

### Tasks

#### Wave 12 (parallel)

- [ ] **Highlighter** (FR-19…FR-21)
  - Standard aliases (`ts`, `typescript`, `js`, `javascript`) are deferred to Obsidian. Custom names use a Lezer `@lezer/javascript` TS/JS parse of extracted code only, cached per changed block and emitting decorations for visible ranges only.
  - Isolated token→host-class adapter, based on S2 data. No marks on container prefixes. Does not replace or reveal Live Preview-hidden content. Independent of TypeScript load.
  - `@lezer/javascript` bundled, with host Lezer packages externalized.
- [ ] **Wrap modes and JS fences** (FR-7, FR-8)
  - `"none"`, `"async-function"` (`(async () => {\n` + block + `\n})();`), and `{prefix,suffix}`, all feeding the position map and the worker file text.
  - A wrapper or language change invalidates that block's pending queries. `js` fences get `checkJs` and JSDoc.
- [ ] **Lifecycle and errors** (FR-22, FR-24, FR-24a, FR-25, §6)
  - `ready()`, `setEnabled`, `dispose` semantics exactly per §6: shared concurrent init, rejects when disabled, no features, or blocked by mobile; post-dispose behaviours; extension goes inert immediately.
  - `onError` called once per failure episode. No automatic restart loop; disable then re-enable retries with the latest declarations. Expected shutdown does not call `onError`.
  - Mobile policy (`Platform` from `obsidian`): `mobile: false` → highlight only.
  - Closing the last typed editor removes files and keeps a warm worker.
- [ ] **Registry-driven refresh**: ownership changes refresh attached editors. Highlighting also obeys ownership.

#### Wave 13 (after Wave 12)

- [ ] **Tests**: wrap/JS cases via worker core and state tests (`return` valid only in async wrapper; JS `@type` error); lifecycle tests with the controllable transport (init failure episode, timeout, retry, dispose mid-request, globals update during init); highlight tests in the DOM harness (viewport-only decorations, no reparse on scroll, no prefix marks, Live Preview hidden content untouched).
- [ ] **Coexistence fixture**: a second local fixture consumer with distinct id and fences, used in tests and the example vault (conflict, release, promotion).
- [ ] **Highlight acceptance** in Obsidian desktop: default theme and the named community theme (ruling 9). Record app and theme versions in `docs/acceptance.md`.

### Checkpoint

- [ ] Wrap, JS and lifecycle tests green. Highlight acceptance recorded for two themes.
- [ ] No consumer-visible global override verified: another source's completions and lint still work (browser test).

---

## Phase 7: Run Helper (M3, runs independently of Phases 4–6 after Phase 3)

Goal: `obsidian-typed-codeblocks/run` per FR-28…FR-35. It may be built in parallel with Phases 4–6 by a separate subagent (only `src/shared` is shared).

### Tasks

#### Wave 14 (parallel; may overlap Waves 7–13)

- [ ] **Syntax gate** (FR-29, FR-34)
  - Parse with the ruling 6 parser and reject by syntax tree, never regex: static/dynamic `import`, `export`, JSX/TSX, top-level `await` with `wrap: "none"`, and non-erasable constructs (non-ambient `enum`/`const enum`, namespaces with runtime code, constructor parameter properties, `import … =`, `export =`). Errors name the construct and original line/column.
  - Wrapping is applied before parsing so block-level `await` and `return` parse correctly.
- [ ] **Transform and source maps** (FR-31, FR-33)
  - Sucrase transform with `transforms: ["typescript"]`, and no downleveling. JSX and enum emission are disabled or unreachable because the gate rejects them first.
  - Compose Sucrase maps with the wrapper and the evaluator framing, so errors report one-based original line/column even when type removal shifts columns. Best-effort stack mapping, never invented positions, original error kept as `cause` (including non-Error throws), original stack preserved.
- [ ] **compileBlock / runBlock** (FR-29, FR-30)
  - `compileBlock` returns a synchronous function body. `runBlock` always returns a `Promise<unknown>` and rejects on compile errors, sync throws and rejected async work.
  - Own enumerable globals are bound as function parameters after validating each key (distinct, valid strict-mode identifier, not reserved, not `eval` or `arguments`); never interpolated unvalidated.
  - Strict mode, with an inner scope so block declarations shadow injected names. Result table per §5.9: `none` and custom → `undefined`. `async-function` → the evaluator returns the invocation promise (evaluator-only `return` included in the source map, not in the editor's module).
- [ ] **verifyGlobals** (FR-32): the top-level ambient `declare const|let|var|function` scan, respecting comments, strings and nesting. One warning per distinct mismatch per declaration/key set. Reports inconclusive cases (`declare global`, namespaces, ambient classes/enums, destructuring) instead of false missing-key warnings.

#### Wave 15 (after Wave 14)

- [ ] **Run-helper tests** (spec §10): real execution of `return 42`, rejected promises, `undefined` in other modes, strict mode, shadowing of injected names, invalid and reserved global names, unsupported syntax, comment/string text not triggering bans, error metadata after column-shifting type removal, a non-Error throw, an unmapped stack frame.
- [ ] **Shared parity fixture** (FR-34): one list of erasable and non-erasable snippets run through the editor checker (worker core with `erasableSyntaxOnly`) and the helper gate. Assert identical accept/reject.
- [ ] **Graph check**: `/run` bundle excludes TypeScript, worker, CM6 and obsidian. Root excludes the Sucrase stripper and evaluator.

### Checkpoint

- [ ] Parity fixture green. Graph check green. Run helper works in the Node test environment and in a browser harness (to catch `new Function` constraints).

---

## Phase 8: Quality, Quick Fixes, Packaging, Example, Docs (M3)

Goal: finish the user-visible polish, verify packaging, collect the one-time measurements and ship docs.

### Tasks

#### Wave 16 (parallel)

- [ ] **Spelling quick fixes** (FR-16)
  - Expose `getCodeFixesAtPosition` fix `fixSpelling` as diagnostic actions. Apply only single-line replacements entirely inside the same current block, in the code region. Reject changes to declarations, wrappers, other files and container markers.
  - Revalidate block text and globals revision at action time. One undoable transaction.
  - Tests: the `info.titel` → `title` happy path, plus stale-revision and out-of-block rejection.
- [ ] **Example plugin and fixture vault** (spec §10 Manual): `examples/` consumer plugin using both entries (`km`-style globals incl. the `Query<Used>` types, `async-function` wrap, a `registerMarkdownCodeBlockProcessor` using `runBlock`) plus the second coexistence consumer.
- [ ] **Package fixtures**: consumer fixture builds resolving root and `/run` in ESM and CJS using Obsidian's single-file CJS build. Public API examples compile without importing TypeScript types (type tests for `TypedCodeBlocksOptions`, `BlockWrap`, `RunBlockOptions`).
- [ ] **Docs**:
  - README: consumer guide, the exact externals list, ambient-vs-`declare global` forms (§5.10), FR-11a `languageData` migration requirement, FR-26a generic-fence warning, the fixed 30 s timeout, limitations §8, third-party licence notices (TypeScript, libs, grammar, transformer), and the `ts`-code range from ruling 5.
  - `docs/scanner-fixtures.md` finalized.

#### Wave 17 (after Wave 16)

- [ ] **Single performance and size sample** (§9): one desktop host, a quick sample on a ≤300-line block with a ≤5k-line globals file. Record the host, build, approximate cold and warm timings, and bundle size in the README. No p95 claims and no extra hosts. If a material problem appears, write it up as a ruling for the author before any further measurement.
- [ ] **Manual e2e in Obsidian** (`docs/acceptance.md`):
  - Desktop in Live Preview and Source: all §4.3 scenarios.
  - Offline production Blob worker startup.
  - Mobile highlight-only mode.
  - Opted-in mobile worker startup, if full mobile support is to be advertised.
  - Coexistence with the second fixture consumer. kind-model's `km` completion/linter is tested when that external repo is available.
  - Record the exact desktop and mobile Obsidian releases and theme versions; set the advertised `minAppVersion` from the evidence (ruling 10).
- [ ] **Final traceability pass**: a table `docs/fr-coverage.md` mapping FR-1…FR-35 to test files or acceptance records. Gaps are filled or reported.

### Checkpoint (release gate)

- [ ] `pnpm test`, `pnpm build`, `pnpm check:graph` and package fixture builds all green.
- [ ] `docs/acceptance.md` and `docs/fr-coverage.md` complete; README contains measured size and timing sample.
- [ ] kind-model integration (including the FR-11a migration) is listed as an external follow-up, not claimed done.

---

## Wave Summary

| Wave | Phase | Tasks (concurrent) |
|---|---|---|
| 1 | 1 | scaffold, spikes S1/S2/S3 |
| 2 | 1 | record rulings, build pipeline |
| 3 | 2 | scanner core, prefix mapper, position map |
| 4 | 2 | incremental rescan, fixture/mapping suites |
| 5 | 3 | options, globals validation, registry |
| 6 | 3 | validator tests, registry tests, smell grep |
| 7 | 4 | worker core, protocol/client, worker bundling |
| 8 | 4 | LS integration tests, protocol tests, Blob smoke |
| 9 | 5 | fenceField + sync |
| 10 | 5 | completion, linter, hover |
| 11 | 5 | state/view tests, lazy-start test |
| 12 | 6 | highlighter, wraps/JS, lifecycle, registry refresh |
| 13 | 6 | tests, coexistence fixture, highlight acceptance |
| 14 | 7 | syntax gate, transform/maps, compile/run, verifyGlobals (may overlap Waves 7–13) |
| 15 | 7 | run tests, parity fixture, graph check |
| 16 | 8 | quick fixes, example plugin, package fixtures, docs |
| 17 | 8 | perf/size sample, manual e2e, FR traceability |
