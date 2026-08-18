# prreview: product specification (v1)

## 1. One-liner

> `npx @jv-vogler/prreview` spins up a GitHub-style diff viewer on localhost that uses the agent CLI you
> already have to explain what a changeset actually does: its intent, its mechanics, and its
> implications. From there, you curate grounded review comments into a markdown scratchfile or
> a pending GitHub review.

## 2. Problem

AI made writing code fast. Human comprehension and review are now the bottleneck.

- GitHub's diff view shows text changes, not understanding: files in alphabetical order, no
  sense of intent, no grounding in the unchanged code around the diff.
- Existing AI reviewers (CodeRabbit, Copilot review) optimize for comment volume. Volume turns
  into noise, reviewers learn to ignore the balloons, and trust in the tool collapses.
- Existing local diff viewers (difit, tuicr) render diffs nicely but don't help you understand
  them.
- The review philosophy that actually works (grounded, precise, human-curated, as practiced in
  the `local-pr-review` skill) is trapped in a text-file workflow: no anchoring to lines, no
  curation UI, no publish path.

### Competitive landscape

- **difit / tuicr**: local diff viewers with great ergonomics and no comprehension layer. They
  show the change; they don't explain it.
- **CodeRabbit / Copilot review**: AI reviewers optimized for comment volume on the PR itself.
  That is exactly the noise problem prreview is designed against, and both are bound to a SaaS.
- **GitHuman** (Matteo Collina): a local-first review checkpoint for *staged* changes where the
  human writes comments that are handed back to the AI agent. That is the inverse of prreview's
  data flow: there, the human annotates for the agent; here, the agent annotates for the human,
  who curates. GitHuman has no AI analysis, no comprehension layer, and no GitHub publishing.
  It validates two of prreview's bets (local-first review UIs for the agent era, and a
  structured comments-to-agent handoff, which is our F11 fix brief) while leaving comprehension
  entirely open.

## 3. Positioning & differentiators

1. **Comprehension-first.** The product's job is that you *understand* the change. Review
   comments are a byproduct of understanding plus judgment, not the point.
2. **Grounded, precision over volume.** A diff lies by omission. Every finding must be
   traceable to real code the agent actually read: definitions, the data model, sibling code,
   tests. A few high-confidence findings beat balloon spam, and one wrong confident comment
   costs more trust than a missed nit.
3. **Human as editor-in-chief.** Nothing publishes without passing through the user's hands.
   GitHub publishing lands as a *pending* review that the user finalizes and submits from
   GitHub itself.
4. **Local-first, bring-your-own-everything.** No SaaS, no accounts, no new API key.
   Intelligence comes from the agent CLI the user already has, GitHub access from their
   existing `gh` auth, ticket access from their existing integrations. Nothing leaves the
   machine except the agent's own traffic and explicit publishes.
5. **Works where the work is.** The same tool reviews a colleague's (or an AI's) PR and
   self-reviews local changes before a PR exists.

## 4. Personas

Both are first-class.

- **The reviewer** is assigned a PR, increasingly large and AI-generated, and must genuinely
  understand it before approving. They need orientation, prioritization, and a fast path from
  understanding to publishable comments.
- **The author** has local changes or a branch. They want to understand what they actually
  built, catch problems before pushing, and produce an honest PR description.

## 5. Core concepts

- **Changeset**: the unit of review. A PR, a branch vs its base, a commit range, or the working
  tree (staged + unstaged).
- **Annotation**: an AI-produced note anchored to code. There are three species, and they must
  be visually distinct:
  - **Explanation**: a comprehension note (intent, mechanism, implication). Never published.
  - **Finding**: a candidate review comment about an issue *this change introduced*. It must
    cite the evidence that grounds it, and it becomes publishable after curation.
  - **Related finding**: a real pre-existing problem noticed nearby. Kept in a separate lane,
    optional, never mixed with review feedback.
- **Curation state**: every finding is `proposed → accepted | edited | dismissed`. A dismissal
  can carry a reason that informs later analysis in the session.
- **Session**: persisted review state (annotations, curation, coverage, chat history),
  resumable across restarts and stored locally.

## 6. The core loop

1. **Open.** `npx @jv-vogler/prreview` auto-detects the changeset. Explicit forms: PR number/URL, branch
   vs base, commit range, working tree. The tool states what it resolved.
2. **Understand.** One screen, one pass. It opens with what this change is for, the ticket when
   one was cheap to find, and whether the code appears to do what it set out to do; then the
   change retold as plain-language topics, each carrying the hunks that serve it. Topics overlap
   where one hunk does two things — they name what the change does rather than partition it. Read
   this before any diff.
3. **Browse.** The plain diff, always available and free. Mark a file **Viewed** the way you do on
   GitHub and it folds away; coverage counts what you ticked, never what scrolled past. A toggle
   overlays suggested comments as balloons where they land.
4. **Review.** *Suggested comments*: candidate comments about problems this change introduced, at
   a depth you choose. A separate, deliberate spend — nothing chains it off step 2. Problems that
   predate the change are kept in their own section and never mixed into review feedback.
6. **Interrogate.** Chat: repo-grounded Q&A ("who calls this?", "why is this safe?"), and
   operations on the suggested comments themselves.
7. **Curate.** Accept, edit, or dismiss comments. A dismissal is remembered, so a later pass does
   not raise it again.
8. **Ship.** Export the markdown scratchfile and/or publish a pending GitHub review. Authors can
   generate the PR description.
9. **Loop.** Hand accepted findings to a fixer agent as a fix brief. prreview detects that the
   code changed and offers an incremental re-review.

Steps 2–3 share one pass; step 5 is its own. Each AI surface states its own cost before spending
anything, and with no agent installed those surfaces are absent rather than disabled — the diff
viewer stands on its own.

## 7. Functional requirements

**F1. Changeset sources.** PR by number/URL (via existing `gh` auth), the current branch's open
PR, branch vs base, an arbitrary commit range, the working tree (staged/unstaged). The tool
always states which changeset it resolved.

**F2. Diff viewer.** GitHub's visual language; zero learning curve is a feature. Side-by-side
and unified views, a file tree, syntax highlighting, collapse/expand, comfortable handling of
large diffs. It must be a genuinely good diff viewer even with AI features off (see the F12
degradation).

**F3. Annotations.** The three species from §5, visually distinct: explanations must not look
like review comments. Every finding shows its **grounding** (what code the agent read to
conclude it) and a confidence signal. Density is capped by philosophy, not by UI. The analysis
is instructed to produce few, high-confidence findings; there is no balloon per hunk.

**F4. Intent map.** The top-level orientation view: the changeset clustered by purpose ("the
real behavior change is these 40 lines; these 900 are rename fallout; these are test updates"),
relative sizing, and a suggested entry point.

**F5. Guided walkthrough.** The diff reordered into logical reading order with narration
between steps ("start with this migration; the service below reads the column it adds"). Step
progress is shown, and you are free to jump out to browsing and back.

**F6. Risk/attention ranking.** Each hunk gets a needs-human-eyes score, rendered as subtle
heat rather than more balloons. Files and hunks are sortable by attention.

**F7. Coverage tracking.** Tracks which files you marked **Viewed**, per file and in total
("you've seen 70% of this change"). This is the guard against scroll-and-approve, so it is
deliberately never inferred from scrolling — a percentage that counts rows crossing the viewport
measures how far down the page you got, which is the very thing it was supposed to guard
against.

**F8. Chat assistant.** A full assistant: repo-grounded Q&A about the change, annotation
operations (rephrase, redo, split, tone), and triggering re-analysis. It is context-aware of
the currently viewed file and hunk.

**F9. Ticket alignment.** Detect the linked ticket (from the PR body or the branch name) via
the user's existing access, then report whether the change does what the task asked, where
scope creep occurred, and which requirements were missed. Degrades silently when no ticket is
found.

**F10. Curation & publishing.**

- Curation states with in-place editing and batch operations.
- **Export**: a markdown scratchfile compatible with the `local-pr-review` template (foldable
  by file, an Overview, per-file findings, a Related findings section).
- **Publish**: accepted findings become a **pending GitHub review** with correct file/line
  anchors, which the user finalizes and submits on GitHub. prreview never submits a review
  verdict.
- **PR description generation** from the comprehension pass (author mode).

**F11. Fix handoff & re-review loop.**

- prreview **never edits the working tree**.
- "Send to fixer": accepted findings export as a structured **fix brief** for a separate agent
  session. The user chooses the channel: a file, the clipboard, or direct dispatch to the
  agent CLI.
- Change detection: when new commits land, the PR head moves, or the working tree changes, a
  "changes detected" indicator appears and prreview offers an **incremental re-review** of what
  changed since the last pass. Stale annotations are re-anchored or retired; resolved findings
  are marked as addressed.

**F12. Engine.** Drives the user's installed agent CLI. In v1, Claude Code is first-class, and
the product commits to an adapter principle so other CLIs can follow. The agent does the repo
grounding; that is why the engine is an agent and not a raw API call. **Degradation**: with no
agent installed, prreview still works as a quality local diff viewer with the AI features
disabled.

**F13. Session persistence.** Sessions are resumable across restarts and stored locally in a
project-local, gitignored cache. Privacy: nothing leaves the machine except the agent CLI's own
traffic and explicit GitHub publishes.

## 8. Non-goals (v1)

- **Not an editor.** prreview never modifies the working tree; the fix handoff (F11) covers
  that need.
- **Not a CI bot.** No automatic posting, no review verdicts, nothing published without a human
  action.
- **Not a SaaS.** No server-side component, no accounts, no telemetry by default.
- **Not a git GUI.** No staging, committing, or rebasing.
- **Not a linter.** It won't report what linters, typecheckers, and CI already catch.
- **GitHub only** in v1. GitLab and Bitbucket are roadmap.

## 9. Product principles

1. Trust is the currency: precision over volume, grounding mandatory, confidence visible.
2. The human is editor-in-chief: AI proposes, the user disposes.
3. Familiar surface, new depth: GitHub's visual language with comprehension underneath.
4. Local-first, bring-your-own-everything.
5. Worth opening with AI off: the viewer floor must stand on its own.

## 10. v1 internal milestones

All of the above is v1 scope. Ship it in coherent internal milestones:

- **M1 "See"**: CLI + changeset sources + diff viewer + sessions. difit parity; the AI-off
  floor.
- **M2 "Understand"**: engine adapter + explanations + intent map + walkthrough + chat Q&A.
- **M3 "Review"**: findings + the related-findings lane + risk ranking + coverage + curation +
  markdown export.
- **M4 "Ship"**: pending GitHub review + ticket alignment + PR description generation + fix
  brief handoff + change detection / incremental re-review.

## 11. Success criteria

- **Time-to-understanding.** A reviewer can state the intent and main risks of an unfamiliar
  ~500-line PR measurably faster than with the GitHub UI.
- **Signal quality.** A low dismissal rate on proposed findings, measurable from curation
  stats. If most balloons get dismissed, the product is failing its own philosophy.
- **Trust behavior.** Users publish curated comments they have edited and own, rather than raw
  AI output, and they come back for the next PR.
- **Author value.** Self-reviews catch real issues before the push, and PR descriptions come
  out of the comprehension pass instead of being written from memory.

## 12. Open questions (deferred to the architecture session)

- The intermediate representation of the changeset for agent consumption (JSON, TOON, or
  something else).
- The UI stack, the local server model, and how the agent CLI is orchestrated (sessions,
  streaming).
- A feasibility check: GitHub pending reviews created via the API are visible and submittable
  only by the token's user. Confirm this matches the `gh` auth flow. It should, since it's the
  user's own auth.
- How incremental re-review diffs "what changed since the last pass": commit-based or
  content-based.
- Roadmap candidates: other agent adapters, GitLab/Bitbucket, a `review-rules.md` for
  repo-specific review policy, learning from dismissal reasons, a multi-PR review inbox, editor
  deep links, stacked PRs.

## 13. Command-line surface (amendment, 2026-08-14)

Decided together with the architecture. Minimal on purpose: every form below has a concrete
justification, and everything else was rejected.

```
prreview [target] [base]
```

| Invocation | Reviews |
|---|---|
| `prreview` | auto-detect: dirty tree → working tree; else the branch's open PR; else branch vs its base |
| `prreview 482` / `prreview <pr-url>` | that PR |
| `prreview <branch> [base]` | a branch vs a base; the explicit base exists because git cannot detect stacked branches |
| `prreview <from>..<to>` | a commit range, e.g. `HEAD~3..HEAD` to review an agent's last commits |
| `prreview working` | local changes, staged and unstaged together |

Flags: `--port` (fixed port when running several repos; collisions auto-resolve otherwise) and
`--no-open` (don't open the browser; needed on WSL2 and in scripts). Nothing else. Rejected:
`staged` as a separate target (narrow; commit and use a range), `--mode` (UI preference, lives
in the browser), `--no-ai` (analysis only runs on click), `--fresh` (delete `.prreview/`),
`--keep-alive`, `--data-dir`, `--pr`/`--base` (redundant with positionals).
