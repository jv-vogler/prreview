# prreview

> `npx @jv-vogler/prreview` spins up a GitHub-style diff viewer on localhost that uses the agent CLI you
> already have to explain what a changeset actually does: its intent, its mechanics, and its
> implications. From there, you curate grounded review comments into a markdown scratchfile or
> a pending GitHub review.

What ships today is three tabs. **Diff** is a local, GitHub-accurate diff for any PR, branch,
commit range, or your working tree — light and dark themes, keyboard navigation, a file list
ordered by how much attention each file needs, GitHub's per-file "Viewed" box (which folds the
file away and is the only thing that moves the coverage number), and review coverage that
survives restarts. It is free and works with no agent at all. **Understanding** says what the
change is for and whether the code appears to do it, then retells the change as plain-language
topics, each carrying the code that serves it. **Suggested comments** is a list of candidate
review comments about problems this change introduces, at a depth you choose — with what the pass
threw away, and why, so you can see whether the right things were cut. Dismiss one and it stays
recoverable, and a later pass does not raise it again. Nothing is posted anywhere: publishing to
GitHub is still ahead.

## Quickstart

Inside any git repository:

```sh
npx @jv-vogler/prreview
```

The package is scoped; the command it installs is not. However you get it, the thing on your
PATH is `prreview`.

To work on prreview itself, link the checkout onto your PATH instead:

```sh
git clone https://github.com/jv-vogler/prreview && cd prreview
npm install
npm run link          # builds, then npm-links `prreview` globally
```

The link points at the checkout rather than a copy, so `npm run build` is enough to pick up
changes afterwards — no relinking. `npm run unlink` removes it.

Either way, inside any git repository:

```sh
prreview
```

It auto-detects what to review, starts a local server bound to `127.0.0.1`, and opens your
browser. Close the tab and the server shuts itself down. Press `?` in the browser for the
keyboard shortcuts.

If you use a version manager (nvm, mise, fnm), the link belongs to the Node version that was
active when you made it — switch versions and you will need `npm run link` again.

### A PR in another repo

prreview reviews **the repository you run it in**. The PR lookup (`gh pr view`) and the fetch of
the PR's head both happen in that repo, so a PR number *or* a full PR URL only resolves for the
repo you are standing in — the owner/repo in the URL does not send prreview somewhere else. Clone
it first:

```sh
git clone https://github.com/OWNER/REPO && cd REPO
prreview 11                 # or: prreview https://github.com/OWNER/REPO/pull/11
```

The clone needs an `origin` pointing at that repo, and a `gh` login that can see it if it is
private. The session lands in a `.prreview/` directory at that repo's root.

## What you can review

```
prreview [target] [base]
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
| `--brain <path>` | a markdown file of your own review guidelines, handed to the review pass as data |
| `--brain-mode layer\|replace` | add yours to the agent's own judgement (default), or use them instead of it |

That's the whole surface. Diff style and theme are UI preferences: set them in the browser and
they're remembered. `--brain` is a flag rather than a setting because the file has to be read,
hashed, and fenced before any prompt is built, and because the browser cannot hand the server a
path to read.

## What the agent adds

The intelligence comes from the `claude` CLI you already have installed and signed in. There is
no API key to add and no service in between: the analysis runs on your machine, under your own
login and your own limits.

Nothing runs on its own, and **nothing chains**. There are two passes, each with its own button
on its own tab, because reading about a change should never quietly spend on a review you did not
ask for.

**Explain this change** makes one pass and fills two tabs:

- **Overview** — what this change is for, in a paragraph. If a ticket reference was cheap to find
  in the branch name, the PR title, or its body, it is linked. Then a verdict on whether the code
  does what it set out to do. When no ticket was found, the verdict says plainly that it is
  judging the change's internal coherence rather than conformance to a requirement — it will not
  dress up a guess in ticket language.
- **Understanding** — the change as a handful of named topics, each with the hunks that serve it,
  collapsed until you open one. A hunk that does two things appears under both topics, so the
  percentages describe how much of the change each topic covers and do not add up to 100. If some
  hunks belong to no topic, the page says so instead of implying it covered everything.

**Review this change** is a separate pass that fills **Suggested comments**: several independent
readings of the diff — correctness, security, edge cases, and more — merged into one list. Each
comment is checked before you see it: its citations must be files the agent actually opened, its
prose must be short enough to paste, and a confidently-worded blocker that cites something unread
is dropped rather than shown. Problems that were already there sit in their own section and never
mix into feedback about someone's change.

A chat dock (`c`) answers questions from the repository at the revision under review, so it can
tell you who calls a function the diff never shows.

Each pass is billed to your own `claude` account, and the cost of every run is recorded in
`.prreview/`. Without `claude` on your PATH the three AI tabs do not appear at all: you get the
diff and one notice explaining why.

### What the agent may touch

It only reads. The child process is allowed `Read`, `Glob`, and `Grep` and denied `Write`, `Edit`,
and `Bash`, so prreview never edits your working tree. For a PR or a commit range it reads the
code at the reviewed revision from a detached `git worktree` under your cache directory
(`$XDG_CACHE_HOME/prreview`, or `~/.cache/prreview`), never from inside your repository, and
removes the ones it created on the way out.

## Sessions

prreview stores your progress in `.prreview/` at the repository root, and excludes it from git via
`.git/info/exclude`, never your `.gitignore`. That covers which hunks you've seen, the
the topics and the overview, the suggested comments and their anchors, and the chat history. Kill the server, rerun the same invocation, and all of it resumes. Delete `.prreview/`
to reset.

## Not here yet

- exporting the suggested comments as a `.prreview/review-*.md` scratchfile
- asking chat to reword or drop a comment (you can do both by hand on the tab)
- the fix brief, and publishing a pending GitHub review

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
