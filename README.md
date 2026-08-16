# prreview

> `npx prreview` spins up a GitHub-style diff viewer on localhost that uses the agent CLI you
> already have to explain what a changeset actually does: its intent, its mechanics, and its
> implications. From there, you curate grounded review comments into a markdown scratchfile or
> a pending GitHub review.

That's the destination. What ships today is M1, the viewer: a local, GitHub-accurate diff for
any PR, branch, commit range, or your working tree. It has light and dark themes, keyboard
navigation, a file list ordered by how much attention each file needs, and review coverage that
survives restarts. The AI features (explanations, annotations, comment curation, publishing to
GitHub) come in M2 and later.

## Quickstart

Run it inside a git repository:

```sh
npx prreview
```

It auto-detects what to review, starts a local server bound to `127.0.0.1`, and opens your
browser. Close the tab and the server shuts itself down.

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

## Sessions

prreview stores review progress (which hunks you've seen) in `.prreview/` at the repository
root, and excludes it from git via `.git/info/exclude`, never your `.gitignore`. Kill the
server, rerun the same invocation, and your coverage resumes. Delete `.prreview/` to reset.

## Requirements

git and Node.js 20.19 or newer. Reviewing PRs works best with the GitHub CLI (`gh`) installed
and authenticated; without it, prreview can still fetch a PR's diff over your existing `origin`
remote.

On WSL2 and headless machines, opening a browser from the terminal may fail. prreview prints
the URL either way: open it yourself, or pass `--no-open` to skip the attempt.

## License

[MIT](./LICENSE)
