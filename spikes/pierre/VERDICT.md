# Spike 1 verdict: `@pierre/diffs` — **GO**

Date: 2026-08-15 · Package: `@pierre/diffs@1.3.5` (pinned exact) · Verified headless with
Playwright/Chromium against the production Vite build served under the real CSP
(`default-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:;
frame-ancestors 'none'`). Test: `e2e/spike.spec.ts` (1 passed). Raw findings: `capture.json`.

## Per-criterion results

| # | Exit criterion (ARCHITECTURE §17.1 / plan TASK-010..012) | Verdict | Evidence |
|---|---|---|---|
| 1 | Render a ≥5,000-line diff across ≥30 files | **GO** | Fixture: 32 files, 5,504 patch lines, 8 hunks/file; virtualized `CodeView` rendered and swept end to end in ~6s of test time, no page errors |
| 2 | 30 variable-height annotation cards, 3 visual species, via `renderAnnotation` portals | **GO** | All 30 distinct `data-annotation-id`s observed across the sweep; species note/warning/suggestion all present; rendered heights 59–157px (7 distinct values); React `createPortal` confirmed in `react/CodeView.js` |
| 3 | Programmatic scroll-to-file (THE go/no-go) | **GO** | `CodeViewHandle.scrollTo({type:'item', id})` landed file #26's container within 220px of viewport top |
| 4 | Programmatic scroll-to-hunk (THE go/no-go) | **GO** | `scrollTo({type:'line', id, lineNumber: hunk.additionStart, side:'additions'})` landed the hunk's first line row (`[data-line]` in shadow DOM) within 220px of viewport top; also exercised 30 more times in the annotation sweep |
| 5 | Split/unified toggle | **GO** | Flipping `options.diffStyle` re-renders: unified shows `[data-unified]` rows; split shows paired `[data-deletions]`/`[data-additions]` columns; toggled both directions |
| 6 | Worker pool under CSP `worker-src 'self' blob:` | **GO** | 4 workers via `WorkerPoolContextProvider` + `workerFactory` importing `@pierre/diffs/worker/worker.js?worker` (Vite `worker.format:'es'`); pool reached `initialized`, `workersFailed:false`, diff highlights flowed through the pool; `securitypolicyviolation` listener captured **zero** violations across the whole run |
| 7 | `loadDiffFiles` request/response shape pinned (fixes the `BlobResponse` dto, TASK-035) | **GO** | Captured — see below |
| 8 | `registerCustomCSSVariableTheme` on a live theme flip: cascade vs snapshot | **ANSWERED: cascade** | Token spans carry `style="color:var(--diffs-token-function, #8250df)"`; flipping a root `data-*` attribute that redefines `--diffs-*` recolored tokens (rgb(130,80,223)→rgb(210,168,255)) and the pre background (white→#0d1117) live, with no re-render. The `variableDefaults` passed at registration are only `var()` fallbacks |

**Overall: GO.** Phase 7 diff tasks (TASK-046..048) are unblocked.

## Captured `loadDiffFiles` contract

```ts
// The renderer calls the loader with the file's FULL FileDiffMetadata:
type FileDiffContentsLoader = (fileDiff: FileDiffMetadata) => Promise<FileDiffLoadedFiles>;

// Observed request object keys (patch-parsed fixture):
// additionLines, cacheKey, deletionLines, hunks, isPartial, mode, name,
// newObjectId, prevName, prevObjectId, splitLineCount, type, unifiedLineCount
// Identifying fields usable for the server call:
//   name (new path), prevName? (old path), newObjectId?/prevObjectId?
//   (from the patch's `index` line), type ('change'|'rename-*'|'new'|'deleted')

// The loader must resolve with:
type FileDiffLoadedFiles =
	| { oldFile: FileContents; newFile: FileContents } // changed file
	| { oldFile: null; newFile: FileContents }; // pure rename

interface FileContents {
	name: string;
	contents: string; // full file text
	lang?: string;
	header?: string;
	cacheKey?: string; // supply a stable key so worker highlights are reused
}
```

Implication for `BlobResponse` (TASK-035): the blob endpoint must let the client wrapper
produce `{name, contents}` per side; the wrapper maps two `GET /api/blob?ref=&path=` calls
(old side from `prevName ?? name` at the base ref, new side from `name` at the head ref) into
`FileDiffLoadedFiles`. Hydration is **lazy per visible file** — with `expandUnchanged: true`
only the file in the render window triggered a load (1 call observed), so the endpoint sees
on-demand, per-file traffic, not a thundering herd.

## API notes for the TASK-046 wrapper

- Multi-file rendering: `CodeView` from `@pierre/diffs/react`, controlled
  `items: CodeViewDiffItem[]` built from `parsePatchFiles(patchText, cacheKeyPrefix)[0].files`,
  item `id` chosen by us (we used the file path).
- Scrolling: `ref` handle `CodeViewHandle.scrollTo(target)` with
  `{type:'item'|'line'|'range'|'position'}` targets; `behavior: 'instant'|'smooth'|'smooth-auto'`.
- Annotations: per-item `annotations: DiffLineAnnotation<Meta>[]`
  (`{side:'deletions'|'additions', lineNumber, metadata}`; `lineNumber: 0` = file-level) plus a
  `renderAnnotation(annotation, item)` prop on `CodeView`.
- Workers: `WorkerPoolContextProvider` with
  `poolOptions: {workerFactory: () => new DiffsWorker(), poolSize}` where
  `import DiffsWorker from '@pierre/diffs/worker/worker.js?worker'` and Vite config sets
  `worker: {format: 'es'}`. The built worker is a same-origin static asset (`'self'`, no blob
  needed in production; `blob:` stays in the CSP for dev tooling headroom).
- Theming: `registerCustomCSSVariableTheme(name, variableDefaults)` once before first render;
  pass `theme: name` in options; define `--diffs-foreground`, `--diffs-background`, and
  `--diffs-token-*` per theme on the page (they pierce the open shadow roots via the cascade).
  This maps cleanly onto the planned `pierre-theme.css` `[data-resolved-theme]` blocks.

## Caveats and unverified items

- **Perceived visual quality and scroll smoothness: unverified — needs human eyes.** All
  programmatic checks passed briskly (full run 5.9s), but nobody has looked at the pixels.
  Phase 7's `npm run dev` completion criterion covers this.
- The highlighter must stay on the default `'shiki-js'` engine. `'shiki-wasm'` would require
  `'wasm-unsafe-eval'` in `script-src`, which ARCHITECTURE §15's CSP does not grant.
- CSP was verified against the production build. The Vite dev server (`--dev` loop) serves
  without our CSP header, so dev-mode worker behavior under CSP is untested and irrelevant.
- `parsePatchFiles` handled the synthetic fixture cleanly; exotic patches (binary, mode-only,
  no-EOF) are the server-side parser's job (gitdiff-parser, Phase 3) — Pierre only ever
  receives what we feed it, so this is out of spike scope.
