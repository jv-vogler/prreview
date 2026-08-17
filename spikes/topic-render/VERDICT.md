# Spike 7 verdict: Understanding-tab render cost — **GO, with a mandatory narrowing recipe**

Date: 2026-08-17 · Package: `@pierre/diffs@1.3.5` (pinned exact) · Chromium via Playwright
against the production Vite build served under the real CSP
(`default-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:;
frame-ancestors 'none'`). Harness: `spikes/topic-render/`, spec `e2e/spike.spec.ts` (1 passed).
Raw numbers: `capture.json`.

## The question

The Understanding tab renders the change as topics, each carrying the code that serves it. The
design picks **many small in-flow `FileDiff` views** over one filtered `CodeView`, and admits a
fallback (static excerpts from the IR, losing split view on that tab) if the instance count
disappoints. Nobody had measured ~48 instances. This spike measures it, over 8 topics × 6 blocks,
with **20 hunks deliberately shared between topics** so the many-to-many case is exercised rather
than assumed.

## Headline: it holds up, easily

| measure | collapsed | all 8 topics expanded |
|---|---|---|
| `diffs-container` instances in the DOM | 0 | 48 |
| instances actually materialized at rest | 0 | **2** |
| total DOM nodes on the page | 51 | **147** |
| JS heap | 9.5 MB | **9.5 MB** |
| time to reach that state | 98 ms (first paint) | **113 ms** (expand-all) |

Under one `Virtualizer`, instance count is close to free: the 48 blocks occupy 56,988 px of
scroll, but only the two in view are ever rendered, so the DOM stays at 147 nodes and the heap does
not move. A full end-to-end scroll sweep materialized **all 48** distinct blocks with **zero
long tasks** and no errors.

One honesty note on a number that looks bad: `scrollSweepMs: 5838` is dominated by the spec's own
deliberate 60 ms settle between scroll steps (~93 steps). It is not a jank measurement. The jank
measurement is `longTasksDuringSweep: 0` / `longestTaskMs: 0`.

Also confirmed:

- **no CSP violations** and **no page errors** across the whole run;
- **omitted hunks are not expandable** — with no `loadDiffFiles` passed, the gaps between a
  topic's hunks render as collapsed regions with no working expander, so a topic block stays a
  curated excerpt rather than a doorway back into the whole file. This is asserted, not assumed.

## The finding that matters: narrowing is not filtering

The design says `@pierre/diffs` "can render arbitrary re-grouped hunk subsets". True — but **not**
by narrowing `fileDiff.hunks` to a subset, which is the obvious implementation and the one that
would have been written in Phase 5.

A `Hunk` carries no text. It carries `additionLineIndex` / `deletionLineIndex`, which are offsets
into the **file-level** `additionLines` / `deletionLines` arrays. Drop hunks without rebuilding
those arrays and every surviving offset points at the wrong row. The renderer says so:

```
DiffHunksRenderer.processDiffResult: deletionLine and additionLine are null, something is wrong
```

Measured A/B over the same 8 files (`src/Probe.tsx`, `?probe=full` vs `?probe=narrow`):

| mode | files rendered | console errors |
|---|---|---|
| every hunk, untouched | 8 / 8 | 0 |
| `hunks` array filtered naively | **0 / 8** | **32** |
| `hunks` narrowed by the recipe below | 8 / 8 | 0 |

### The recipe (`narrowToHunks` in `src/topics.ts`)

Narrowing means re-deriving the whole projection, not filtering one array:

1. keep the selected hunks, sorted into file order;
2. rebuild `additionLines` / `deletionLines` from just those hunks' slices;
3. re-base each hunk's `additionLineIndex` / `deletionLineIndex` into the rebuilt arrays;
4. recompute `collapsedBefore` so dropped hunks become collapsed gaps rather than vanishing;
5. recompute `splitLineStart` / `unifiedLineStart` and the file's two line totals;
6. set `isPartial: true` — which is exactly what it now means.

**Slice by `additionCount` / `deletionCount`, never by `additionLines` / `deletionLines`.** The
`*Count` fields are the hunk's total span in that version of the file, context rows included; the
`*Lines` fields count only the `+`/`-` rows. Slicing by the latter leaves the renderer short of
context and reproduces the same null-line error — this cost a debugging round here so that it
costs none in Phase 5.

`cacheKey` must include the subset (`name@objectId#i,j,k`), so two topics showing the same subset
share cached highlights while two different subsets of one file never collide.

## Consequences for Phase 5

- **Proceed with in-flow `FileDiff` views.** The fallback is not needed and should not be built.
- The topic list **must** sit inside one `Virtualizer` with its own scroll container. Without it,
  all 48 instances render eagerly and the page degrades badly — an earlier run of this same
  harness, before the `Virtualizer` was added, left 47 of 48 blocks stuck part-rendered.
- Because the virtualizer owns the scroll container, anything that scrolls the Understanding tab
  (topic rail, deep links) must scroll **that element**, not `window`.
- `narrowToHunks` is production code, not spike code. It belongs in the client's domain layer with
  its own unit tests over the six steps above, and it is the natural place to enforce that a block
  is keyed composite (`${topicId}:${fileName}`), never by hunk alone.
- Collapsed-by-default is nearly free (51 DOM nodes, 98 ms), so the design's "may default
  collapsed" can be "does default collapsed" without a performance argument either way.

## Reproducing

```sh
cd spikes/topic-render
npm install
npm run spike        # vite build && playwright test
```
