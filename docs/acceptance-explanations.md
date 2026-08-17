# Acceptance script: the explanations milestone

In plain terms: this is the walk-through to run against a real pull request of your own before
calling the explanations milestone (M2) accepted. Everything mechanical is already covered by the
automated gates — the whole suite, the two Playwright specs that drive the built artifact against
a fake `claude`, and the opt-in real-CLI smoke. What no test can do is judge whether the
explanations are *any good* on your code, which is the only question left.

Budget about twenty minutes plus one comprehension run's wall clock. Record what you find in
`plan/feature-m2-understand-1-execution-notes.md` under Phase 10.

## Before you start

```sh
claude --version          # expect 2.1.233 or newer, and an account that is signed in
node --version            # expect v20.19 or newer
gh auth status            # optional; without gh, PR diffs come over the origin remote
```

Pick a real, open pull request in a repository you know well, big enough to be worth explaining
(roughly 5 to 30 changed files). Reviewing something you already understand is the point: you are
grading the explanations, so you need the answer key.

Then, in that repository:

```sh
npx prreview <pr-number>
```

Expect one line naming what it resolved and one serving `http://127.0.0.1:4973/`, and a browser
tab. If the tab doesn't open, use `--no-open` and the printed URL.

## 1. The change arrives before any agent does

Nothing should have contacted `claude` yet beyond `claude --version`.

Good: the diff renders, the file list is ordered by how much attention each file needs, the
coverage ring is at or near 0%, and there is no orientation link, no notes in the margin, and no
walkthrough button. The only agent-shaped thing on screen is the **Explain this change** button.

Bad: any note, panel, or spinner suggesting an analysis you didn't ask for.

## 2. One analysis

Press **Explain this change**, and start a stopwatch.

Good: a tray appears under the header saying the agent is reading the change, with a **Stop**
button and a live elapsed time. On a real PR expect a couple of minutes; the hard ceiling is ten.
When it lands the tray disappears, notes appear in the margin of the diff, and an **Orientation**
link appears in the header.

Bad: a tray that never settles, a failure message, or a completed run that produces nothing.
If it fails, the message names what happened; **Try again** re-runs, and the failure reason plus
the agent's stderr tail are worth pasting into the notes.

Record: wall-clock time from press to notes appearing.

## 3. The intent map (F4)

Click **Orientation**.

Good, and this is the one to be hardest on: the summary paragraph should say what the change is
*for* in terms you would use with a colleague, not restate the file list. The parts below it
should be named groups you recognize (the behaviour change, the fallout, the tests) with bars whose
proportions match your own sense of where the work is. The "Start with …" link should open the file
you would actually have opened first.

Bad: a summary that only paraphrases the diff; groups that are really just directories; a
suggested entry point that lands on a lockfile or a test.

Watch for: **percentages missing entirely.** That means the agent named no hunk ids this round
recognises (see the caveats below).

## 4. The explanations (F3)

Back on the diff, read the notes in the margin, particularly on the files you know best.

Good: each note sits on the lines it is about, says something you would have had to work out
yourself (why this parameter is optional, what this early return prevents, what breaks downstream),
and reads as an explanation rather than as a review comment. Visually they should be quiet: a
muted strip with no buttons and nothing to accept or dismiss. `]` and `[` jump between them.

Bad: a note describing code a line or two away from where it sits; a note that is really a
complaint ("this should use a guard clause"); a note that only restates the diff in English.

Record: any note that landed on the wrong lines, with the file and the note's text. Anchoring is
the part most likely to need tuning against real code.

## 5. The guided walkthrough (F5)

Press `w`, or the **Walkthrough** button.

Good: a strip under the diff with a step count, a title, and a narration; the diff scrolls to the
step's code as you enter it; **Next** and **Previous** move you through in an order that reads
like the order a person would explain the change in. The coverage ring rises as you go, because
reading a step counts its hunks as reviewed. **Browse freely** leaves the guided order and keeps
your place; `w` puts you back where you were.

Bad: steps in an arbitrary order; a step that scrolls nowhere; coverage that does not move.

## 6. The chat dock (F8)

Put the cursor on a hunk you have a real question about and press `c`.

Good: a rail opens beside the diff (the diff narrows, nothing is covered), showing which file and
hunk your question will be framed with. Ask something the diff alone cannot answer — "who calls
this?", "what did this replace?", "is anything else relying on the old behaviour?" — and the answer
should stream in within a few seconds and be grounded in the repository, not in the patch. The diff
stays usable the whole time.

Bad: an answer that only paraphrases the hunk; an answer that invents a caller; a dock that covers
the code you are asking about.

## 7. It all comes back

Wait a couple of seconds after the last thing you did (writes are debounced), then kill the server
hard rather than closing the tab, and run the same invocation again:

```sh
pkill -9 -f 'prreview/dist/cli.js'
npx prreview <pr-number>
```

Good: stdout says `session: resumed`, and the header shows `resumed`. The notes, the orientation
page, your place in the walkthrough, your coverage, and the chat history are all there, without
re-running anything.

Bad: anything missing. That is a persistence bug, and the session directory is the evidence:

```sh
ls .prreview/sessions/*/            # session.json, coverage.json, annotations.json, chat/, rounds/
```

## 8. Without an agent, it is the viewer

A `claude` that cannot answer `--version` counts as absent, which is the easiest way to reach this
state without touching your installation:

Stop the server from step 7 first (one prreview per session), then:

```sh
mkdir -p /tmp/no-claude
printf '#!/bin/sh\nexit 127\n' > /tmp/no-claude/claude && chmod +x /tmp/no-claude/claude
env PATH="/tmp/no-claude:$PATH" npx prreview <pr-number> --no-open
```

Good: the diff, the file tree, and coverage all work; one dismissible **Viewer only** notice
explains that no agent CLI was found; the Explain button, the orientation link, the walkthrough,
and the chat dock are all absent rather than greyed out. Dismissing the notice sticks. The
explanations stored in step 2 are still on disk and stay hidden, because the client makes no
request the M1 viewer did not make.

Bad: any AI affordance that is present but broken, or a second notice.

## 9. What one run cost

```sh
node --input-type=module -e '
import { readdirSync, readFileSync } from "node:fs";
const dir = ".prreview/sessions/" + readdirSync(".prreview/sessions")[0];
const manifest = JSON.parse(readFileSync(dir + "/session.json", "utf8"));
console.log(manifest.rounds.flatMap((round) => round.runs));
'
```

Each run records `stage`, `model`, `startedAt`, `endedAt`, `costUsd`, `numTurns`, and `status`.
Record the comprehension run's cost and turn count.

## Known caveats, so they don't read as surprises

1. **Percentages and bars can be missing on the orientation page.** They are computed from the
   hunk ids the agent names. Ids the round doesn't recognise now fall back to counting the whole
   file, so a cluster is never sized at zero while it visibly contains a file; but if the agent
   names no usable ids *and* no paths this round contains, the page drops the bars rather than
   inventing proportions. The names, descriptions, and links still work.
2. **A question whose turn never produces a single frame will hold up the next question.** The
   client waits for the previous answer to settle before sending the following one, and there is no
   client-side deadline. Reloading the page clears it.
3. **The walkthrough strip and the chat dock can be open at the same time**, which on a narrow
   window leaves the diff about half the viewport. Both close with one keystroke (`w`, `c`).
4. **A walkthrough position can outlive the steps it referred to.** After a refresh into a new
   round, the strip stays hidden until the next analysis, but the stored position may still name a
   step from the previous reading order. Entering the walkthrough again clamps it.
5. **Cost is recorded, not displayed.** Nothing in the UI reports what a run cost; step 9 is how
   you find out.
6. **Risk scores are captured and stored but never shown.** Stage A produces them, and the heat
   they drive is part of the next milestone.

## If something is wrong

Write it into `plan/feature-m2-understand-1-execution-notes.md` under Phase 10 with enough detail
to reproduce: the invocation, the file and lines, what you expected, and what you got. For anything
involving the agent's own behaviour, `.prreview/sessions/*/rounds/*/analysis.json` holds the raw
stage-A output and the read log, which is usually where the answer is.
