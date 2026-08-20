---
name: prreview
description: Open prreview, a local GitHub-style diff viewer that can also explain a change, so a human can review code in their browser. Use whenever the user wants to review a PR, a branch, a commit range, or their working-tree changes in a browser — "review this PR in a browser", "let me look at my changes", "open prreview", "self-review before pushing", "show me the diff for branch X", "explain this change to me" — or when handing off your own commits for a human to inspect. It serves the diff on localhost with review-coverage tracking, and on request explains the change using the reviewer's own claude CLI; it does not post anything to GitHub.
---

# prreview

prreview is a CLI (`npx @jv-vogler/prreview`, command `prreview`) that resolves a changeset from git or GitHub, then serves a
GitHub-accurate diff viewer on `127.0.0.1` for a human to review. It tracks which hunks the
reviewer has seen, and that coverage survives restarts. It is read-only toward GitHub: nothing
is posted, commented, or approved.

When the reviewer's machine has an authenticated `claude` CLI, prreview can also explain the
change and suggest review comments about it — but only when the reviewer clicks the button for
that pass in the browser. Nothing is analyzed at startup and prreview adds no flag for it, so this
is never something you trigger from the command line.

## Pick the invocation

```
prreview [target] [base]
```

| Invocation | Reviews |
|---|---|
| `prreview` | auto-detect: dirty tree → working tree; else the branch's open PR; else branch vs its base |
| `prreview 482` / `prreview <pr-url>` | that pull request |
| `prreview <branch> [base]` | a branch vs a base; pass the base explicitly for stacked branches |
| `prreview <from>..<to>` | a commit range, e.g. `HEAD~3..HEAD` to review an agent's last commits |
| `prreview working` | local changes, staged and unstaged together |

Bare `prreview` almost always does the right thing; reach for an explicit target when the user
names one or when you want to scope the review (e.g. only the commits you just made:
`prreview HEAD~3..HEAD`).

Flags — there are exactly two:

| Flag | Does |
|---|---|
| `--port <number>` | preferred port (default 4973); when taken, prreview walks upward to a free one |
| `--no-open` | don't open a browser; prreview prints the URL instead (headless, SSH, WSL2, scripts) |

## Run it in the background

The process is a server: it keeps serving until the reviewer closes the browser tab (then it
shuts itself down within seconds). A foreground run therefore blocks you indefinitely — always
launch it as a background process.

1. Run `prreview <target>` in the repository, in the background.
2. Read its stdout: it announces what changeset it resolved and the served URL
   (`http://127.0.0.1:<port>/`).
3. Tell the user the URL and what is being reviewed. In environments where opening a browser
   can't work (headless, SSH), pass `--no-open` and hand over the printed URL.

Don't kill the process when your task ends if the user is expected to review — it exits on its
own once the tab closes. Kill it only if the review is abandoned.

## What the reviewer gets in the browser

Always: the diff, a file list ordered by how much attention each file needs, keyboard
navigation, and a coverage ring.

With an authenticated `claude` CLI there are two more tabs, and **each is its own deliberate
spend, billed to the reviewer's own account.** Nothing chains one off the other: reading about a
change must never quietly pay for a review nobody asked for, so each pass is triggered from inside
the tab it fills.

**Understanding**, after they click *Explain this change* — one pass:

- what the change is for, the ticket when one was cheap to find, and whether the code appears to
  do what it set out to do
- the change retold as plain-language topics, each carrying the code that serves it. Topics
  overlap where one hunk does two things; they name what the change does rather than partition it
- a chat dock that answers questions about the code at the reviewed revision

**Suggested comments**, after they click *Review this change* at a depth they pick — a separate,
more expensive pass:

- candidate review comments about problems *this* change introduced, each checked against the code
  the agent actually read and marked when it was not
- problems that predate the change kept in their own section, never mixed into review feedback
- what the pass threw away and why, so "six comments" can be told apart from "everything was cut"

Nothing is posted anywhere. It is a scratchpad the reviewer curates: they can dismiss a comment
and restore it, and a dismissal is remembered so a later pass does not raise it again.

Describe these as available, never as done: whether they exist for a given session depends on the
reviewer's machine and on their clicking the button.

## Where state lives

Progress persists in `.prreview/` at the repository root: which hunks were seen, plus whatever a
pass produced — the change's topics, the suggested comments and how the reviewer curated them, and
the chat history. prreview
excludes it from git via `.git/info/exclude`, so it never touches the user's `.gitignore` and
never shows up in `git status`. Rerunning the same invocation resumes all of it; deleting
`.prreview/` resets it.

## Not yet shipped

These are planned but absent — do not look for them or promise them:

- exporting the comments as a `.prreview/review-*.md` scratchfile
- asking chat to reword or drop a comment (the reviewer can do both by hand on the tab)
- the fix brief, and publishing a pending GitHub review

prreview explains a change and suggests comments about it; it does not publish anything anywhere.
If the user asks for one of these, say it isn't in the installed version yet and offer the review
workflow that is.

## Requirements

git on PATH and Node.js >= 20.19. The explanation features need `claude` on PATH and
authenticated; without it prreview is the viewer alone, and says so in the browser. Reviewing PRs
works best with an authenticated GitHub CLI (`gh`); without it, prreview falls back to fetching the
PR head over the `origin` remote.
