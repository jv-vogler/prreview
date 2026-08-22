# prreview

`npx @jv-vogler/prreview` opens a GitHub-style diff of a PR, a branch, a commit range, or your
working tree, on localhost. Reading the diff needs nothing else. Reviewing it does one more
thing: it drives the `claude` CLI you already have, on your own machine, through the same review
prompt you'd otherwise run by hand — output, edit, and delete individual comments, then publish
the survivors as a pending GitHub review you submit yourself. prreview never posts a verdict for
you.

## Quickstart

Inside any git repository:

```sh
npx @jv-vogler/prreview
```

The package is scoped; the command it installs is not. However you get it, the thing on your
PATH is `prreview`.

With no arguments it auto-detects: the PR for your current branch, or your working tree changes
if there is no PR. You can also be explicit:

```sh
prreview 482          # a PR by number
prreview feat-x main  # a branch against an explicit base
prreview a1b2c3..d4e5f6
prreview working
```

## Requirements

- Reading the diff needs only `git`.
- Reviewing needs the `claude` CLI on `PATH` and signed in. Without it, prreview still serves the
  diff — the review surface is simply absent.
- Publishing needs the `gh` CLI, authenticated against the repo's remote.

## Working on prreview itself

```sh
git clone https://github.com/jv-vogler/prreview && cd prreview
npm install
npm run link          # builds, then npm-links `prreview` globally
```

The link points at the checkout rather than a copy, so `npm run build` is enough to pick up
changes afterwards — no relinking. `npm run unlink` removes it. See `CLAUDE.md` for the
architecture and the empirical constraints the `claude` CLI itself imposes.
