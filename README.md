# prreview

> `npx prreview` spins up a GitHub-style diff viewer on localhost that uses the agent CLI you
> already have to explain what a changeset actually does: its intent, its mechanics, and its
> implications. From there, you curate grounded review comments into a markdown scratchfile or
> a pending GitHub review.

That's the destination. What ships today is the viewer and the explaining. The viewer is a local,
GitHub-accurate diff for any PR, branch, commit range, or your working tree, with light and dark
themes, keyboard navigation, a file list ordered by how much attention each file needs, and review
coverage that survives restarts. The explaining is what the agent adds when you ask for it:
orientation, notes in the margin, a guided walkthrough, and a chat dock. Writing review comments,
curating them, and publishing them to GitHub are still ahead.

## Quickstart

Run it inside a git repository:

```sh
npx prreview
```

It auto-detects what to review, starts a local server bound to `127.0.0.1`, and opens your
browser. Close the tab and the server shuts itself down. Press `?` in the browser for the
keyboard shortcuts.

## What you can review

```
npx prreview [target] [base]
```

| Invocation | Reviews |
|---|---|
| `prreview` | auto-detect: dirty tree → working tree; else the branch's open PR; else branch vs its base |
| `prreview 482` / `prreview <pr-url>` | that PR |
| `prreview <branch> [base]` | a branch vs a base; pass the base explicitly for stacked branches |
| `prreview <from>..<to>` | a commit range, e.g. `HEAD~3..HEAD` to review an agent's last commits |
| `prreview working` | local changes, staged and unstaged together |

## Flags

| Flag | Does |
|---|---|
| `--port <number>` | preferred port (default 4973); when taken, prreview walks upward to a free one |
| `--no-open` | don't open the browser; prreview prints the URL instead (for scripts, ssh, WSL2) |

That's the whole surface. Diff style and theme are UI preferences: set them in the browser and
they're remembered.

## What the agent adds

The intelligence comes from the `claude` CLI you already have installed and signed in. There is
no API key to add and no service in between: the analysis runs on your machine, under your own
login and your own limits.

Nothing runs on its own. Press **Explain this change** and prreview makes one pass over the
change, which produces four things:

- **An orientation page** — what this change is for, broken into named parts sized against each
  other, plus a suggested place to start reading.
- **Notes in the margin** — short explanations anchored to specific lines, saying what a line
  intends, how it works, or what it implies. They aren't review comments, and there is nothing to
  accept or dismiss.
- **A guided walkthrough** — the change in reading order, one narrated step at a time. Reading a
  step counts it as reviewed, so coverage moves along with you.
- **A chat dock** — ask about the hunk you're looking at. Answers come from the repository at the
  revision under review, so it can tell you who calls a function the diff never shows.

One click is one pass, billed to your own `claude` account; the cost of each run is recorded in
`.prreview/`. Without `claude` on your PATH none of this appears: you get the viewer and one
notice explaining why.

### What the agent may touch

It only reads. The child process is allowed `Read`, `Glob`, and `Grep` and denied `Write`, `Edit`,
and `Bash`, so prreview never edits your working tree. For a PR or a commit range it reads the
code at the reviewed revision from a detached `git worktree` under your cache directory
(`$XDG_CACHE_HOME/prreview`, or `~/.cache/prreview`), never from inside your repository, and
removes the ones it created on the way out.

## Sessions

prreview stores your progress in `.prreview/` at the repository root, and excludes it from git via
`.git/info/exclude`, never your `.gitignore`. That covers which hunks you've seen, the
explanations and their anchors, the orientation, where you are in the walkthrough, and the chat
history. Kill the server, rerun the same invocation, and all of it resumes. Delete `.prreview/`
to reset.

## Not here yet

- review findings, comment curation, and the `.prreview/review-*.md` export
- checking the change against its ticket, the fix brief, and publishing a pending GitHub review

If you're looking for those, they aren't in this version.

## Requirements

git and Node.js 20.19 or newer. Explanations need the `claude` CLI on your PATH, authenticated;
everything has been tested against 2.1.233. Reviewing PRs works best with the GitHub CLI (`gh`)
installed and authenticated; without it, prreview can still fetch a PR's diff over your existing
`origin` remote.

On WSL2 and headless machines, opening a browser from the terminal may fail. prreview prints
the URL either way: open it yourself, or pass `--no-open` to skip the attempt.

## License

[MIT](./LICENSE)
