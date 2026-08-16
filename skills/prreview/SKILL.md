---
name: prreview
description: Open prreview, a local GitHub-style diff viewer, so a human can review code changes in their browser. Use whenever the user wants to review a PR, a branch, a commit range, or their working-tree changes in a browser — "review this PR in a browser", "let me look at my changes", "open prreview", "self-review before pushing", "show me the diff for branch X" — or when handing off your own commits for a human to inspect. It serves the diff on localhost with review-coverage tracking; it does not post anything to GitHub.
---

# prreview

prreview is a CLI (`npx prreview`) that resolves a changeset from git or GitHub, then serves a
GitHub-accurate diff viewer on `127.0.0.1` for a human to review. It tracks which hunks the
reviewer has seen, and that coverage survives restarts. It is read-only toward GitHub: nothing
is posted, commented, or approved.

## Pick the invocation

```
npx prreview [target] [base]
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

1. Run `npx prreview <target>` in the repository, in the background.
2. Read its stdout: it announces what changeset it resolved and the served URL
   (`http://127.0.0.1:<port>/`).
3. Tell the user the URL and what is being reviewed. In environments where opening a browser
   can't work (headless, SSH), pass `--no-open` and hand over the printed URL.

Don't kill the process when your task ends if the user is expected to review — it exits on its
own once the tab closes. Kill it only if the review is abandoned.

## Where state lives

Review progress (which hunks were seen) persists in `.prreview/` at the repository root.
prreview excludes it from git via `.git/info/exclude`, so it never touches the user's
`.gitignore` and never shows up in `git status`. Rerunning the same invocation resumes the
session; deleting `.prreview/` resets it.

## Not yet shipped

The current release is the viewer milestone (M1). These are planned but absent — do not look
for them or promise them:

- AI explanations and annotations (M2)
- Comment curation and the `.prreview/review-*.md` export (M3)
- The fix brief and publishing a pending GitHub review (M4)

If the user asks for one of these, say it isn't in the installed version yet and offer the
viewer workflow instead.

## Requirements

git on PATH and Node.js >= 20.19. Reviewing PRs works best with an authenticated GitHub CLI
(`gh`); without it, prreview falls back to fetching the PR head over the `origin` remote.
