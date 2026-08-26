# GitHub review-comment notes

Facts measured against the real GitHub REST API via `gh api`, carried forward across the
rewrite because they are empirical claims about *GitHub*, not about prreview's design.
Rediscovering any of these costs a spike; that's why they're written down. Measured 2026-08-21
with `gh` 2.45.0, against a throwaway PR (`jv-vogler/prreview#2`, base `probe/phase2-base`, head
`probe/phase2-review-comments`, closed and deleted after probing) carrying a fixture file with
three separated hunks (two single-line edits and one deletion) so ranges could be tested across
real hunk boundaries. Re-verify before trusting these against a GitHub Enterprise install or a
materially different API version.

## Pending reviews

- **`POST /repos/{owner}/{repo}/pulls/{n}/reviews` with `event` omitted creates a review in
  `state: "PENDING"`.** Confirmed visible to its own author immediately, both via
  `GET .../pulls/{n}/reviews` and via `gh pr view --json reviews`.
- **A user can hold at most one pending review per pull request.** A second `POST ... /reviews`
  call with `event` omitted, while one is already pending, 422s with `"User can only have one
  pending review per pull request"` — regardless of whether the new call's own comments would
  otherwise have been valid. This masked several of the probes below on the first pass; each had
  to be tested with the previous pending review deleted first.
- **A pending review is deletable while pending**, via `DELETE
  .../pulls/{n}/reviews/{review_id}`, and only while pending — this is how the probes below were
  run one at a time without leaving residue. A **submitted** review (any `event` other than
  omitted) cannot be deleted through the API; the six range/edge-case probes below that needed
  ground truth were therefore submitted with `event: "COMMENT"` rather than left pending, which is
  why the throwaway PR carries visible comments rather than a lingering pending review.
- Not independently re-verified but assumed true: a pending review created through the *user's
  own* `gh` auth is the same review their own browser session would see and can submit —
  `gh pr view --json reviews` reading it back as the same PENDING review is strong evidence,
  since that command hits the same API surface the web UI is built on.

## Comment anchoring

**Every one of the line-range cases below succeeded.** GitHub's REST API does not reject a
multi-line comment whose range spans hunk boundaries or crosses large stretches of unchanged
code. The fear these probes were run to test — that the "Lines 109-193" shape is likely a 422,
and that comments would have to fall back to single-line anchors carrying the range as display
metadata only — is not borne out by this API version. Comments carry a genuine
`start_line`/`line` range, both resolvable through the public
`GET /repos/{owner}/{repo}/pulls/{n}/comments` endpoint once the review is submitted.

One API quirk cost real time here and is worth recording: **the review-scoped comment listing
(`GET .../pulls/{n}/reviews/{review_id}/comments`) never returns `line`/`side`/`start_line`/
`start_side` for comments on a review still pending** — only `diff_hunk` and the legacy
`position`/`original_position` numbers. The fields are real and correct; they only appear once the
review is submitted and the comment is read back through `GET .../pulls/{n}/comments`. Don't
conclude "range not honored" from a pending-review read — submit (or read `diff_hunk`) to check.

Per-case results, all against the fixture's hunks (hunk 1 = lines 5-9, hunk 2 = line 22,
hunk 3 = lines 33-38 with line 35 deleted, on the head commit's line numbering):

| Case | Request | Result |
| --- | --- | --- |
| (a) single line, `side: RIGHT`, inside a hunk | `line: 7` | **201.** Anchors exactly. |
| (b) `start_line`/`line` range fully inside one hunk | `start_line: 7, line: 9` | **201.** `diff_hunk` covers the full range. |
| (c) range spanning two hunks, unchanged code between | `start_line: 9, line: 22` | **201.** Submitted and re-read: `line: 22, start_line: 9, side: RIGHT, start_side: RIGHT` — a genuine range, not silently collapsed to one line. |
| (d) range whose endpoints are valid but spans lines no hunk contains at all (the "Lines 109-193" shape, here spanning all three hunks) | `start_line: 7, line: 36` | **201.** Same as (c) — resolved as a real range across the widest span tested. |
| (e) a line not in the diff at all | `line: 101` (deep unchanged territory) | **422** `"Line could not be resolved"`. |
| (f) `side: LEFT` on a deleted line | `line: 37, side: LEFT` (the deleted line's line number in the base file) | **201.** Anchors as a single-line comment on the base side; `start_line`/`start_side` come back `null` (not a range — expected, deleted lines are single points). |
| (g) a path not in the PR at all | `path: "docs/does-not-exist.md"` | **422** `"Path could not be resolved"`. |

**What prreview does with this is narrower than what GitHub allows.** `placeOnDiff` calls a range
`exact` only when *every* line between `startLine` and `endLine` appears in the file's line index,
and `publishReview` sends `start_line`/`start_side` only for an `exact` placement. A range like
case (c) or (d), whose middle lines sit in unchanged code no hunk contains, therefore clamps to the
nearest rendered line and publishes as a single-line comment, even though the probes show GitHub
would have accepted the whole span. Cases (e) and (g) are the `unplaceable` path. Widening `exact`
to "both endpoints resolve" is available whenever the narrower anchor proves annoying in practice;
it was measured as safe, not adopted.

## Batch failure mode

**One bad comment 422s the entire request; nothing is created, not even the good comments.**
Tested with a two-comment `comments[]` array — one resolvable (`line: 7`), one not (`line: 101`,
the same "Line could not be resolved" case as (e) above). The response was the same single 422
with the same error message, and a follow-up check of `GET .../pulls/{n}/reviews` showed no
pending review at all — the valid comment was not kept.

Consequence: **`publishReview` must pre-validate every comment before sending the batch.** There
is no partial-success path to rely on; a single unplaceable or malformed comment in the outgoing
payload would otherwise silently drop every comment in that publish, including the good ones,
behind one opaque 422. It does this in `buildPublishPayload`, which splits findings into
`included` and `excluded` before any request is made.

## Out-of-diff findings

Both candidate homes for "Related findings (pre-existing)" and anything `unplaceable` work:

- **A review body paragraph** (`POST .../pulls/{n}/reviews` with `body` set and no `comments`,
  submitted with `event: "COMMENT"`) succeeds — plain prose, rendered once above the PR's
  conversation like any other review summary.
- **An issue-level comment** (`POST /repos/{owner}/{repo}/issues/{n}/comments` — PRs are issues
  for this endpoint) succeeds independently of any review and needs no `commit_id` or diff
  context at all.

Either is viable; a review-body paragraph reads as part of the same review the placed comments
belong to, which is the better fit for a pre-existing finding keeping its own lane — an issue
comment is a separate timeline entry with no visual association to the review.
