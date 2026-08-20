# Acceptance script: understanding and suggested comments

In plain terms: the walk-through to run against a real pull request of your own before calling
this build good. Everything mechanical is covered by the automated gates — the whole unit suite,
five Playwright specs driving the built artifact against a fake `claude`, and the opt-in real-CLI
smoke. What no test can do is judge whether the output is *any good on your code*, which is the
only question left.

Budget about twenty minutes, one comprehension run, and one review run of wall clock.

## Before you start

```sh
claude --version          # 2.1.233 or newer, signed in
gh auth status            # for a PR by number or URL
npm run build             # or use the published package
```

Run it from inside the repository the PR belongs to:

```sh
prreview https://github.com/<owner>/<repo>/pull/<number>
```

The first lines it prints are worth reading. They say what it resolved, whether the session is
new or resumed, which toolchain it found, and — if you passed `--brain` — the checksum of the
guidelines it loaded.

## 1. The diff, before anything AI

Land on **Diff**. This should be a good diff viewer on its own merits: file tree ordered by
attention, split/unified with `s`, `j`/`k` between files, `n`/`p` between hunks, `v`/`m` to mark
reviewed, coverage climbing in the header.

*The question:* would you use this to read a PR even if the other two tabs did not exist? If no,
the foundation is wrong and nothing above it will save it.

## 2. Understanding

Open **Understanding**. It should be empty, with an invitation that says what a pass costs.
Nothing has run yet, and nothing should have.

Press **Explain this change**. When it lands:

- Are the topics things a person would actually say out loud, or are they file names in
  disguise? "Retry webhook delivery on 5xx" is right; "Changes to webhook.ts" is a failure.
- Open one. Is the code under it the code that topic is about?
- Do the percentages tell you which topic is the *real* change? They will not add up to 100 —
  topics overlap where one hunk does two things, and that is deliberate.
- If it says some hunks are covered by no topic, is that fair, or did it skip real work?

*The question:* after reading only this tab, could you describe the change to a colleague?

## 3. What the change is for

Still on **Understanding**, at the top — this is not a separate tab and was one for a single
release, which was wrong: it came out of the same pass and read as the same account, so splitting
it charged a click for half a thought.

- Is the summary what the change is *for*, or a list of what it touches?
- If a ticket was found, is it the right one? Check the link.
- Read the verdict carefully. **With no ticket it must say it is judging internal coherence, not
  conformance to a requirement.** If it claims to have checked the change against a ticket it
  never saw, that is the most serious bug this build can have — write it down.

## 4. Suggested comments

Open **Suggested comments**. Pick a depth — the copy should tell you what each one buys in
readings, and if it ever tells you a preset "thinks harder", that is a claim nobody has measured.
Then press **Review this change**. This is the expensive one.

For each comment, the only test that matters: **would you actually post this?**

- Does it lead with the consequence, or narrate the diff back at you?
- Is it about something *this change* introduced? Pre-existing problems belong in the
  "Noticed nearby" section — if one leaked into the main list, that is a real bug.
- Does it duplicate your linter or typechecker? It was told not to, by name.
- Where a comment is marked "not all cited files were read" or "the path was inferred" — is that
  marking honest? Those are the ones to distrust, and the build is telling you so.

Count them. A pass that returns two comments you would post beats one that returns fifteen you
would not. **Zero is a legitimate answer** on a clean change.

Then open **"N candidates didn't make the cut"**. This is the pass grading itself, and it is the
fastest way to judge whether the gates are set right:

- The ones cut for being **too unsure** — would you have wanted to see any of them?
- The ones cut for **being badly written** — is that fair, or was a real problem thrown away for
  its prose?
- A blocker cut for **not being grounded** is the gate doing its most valuable work. If you see
  several, the pass is guessing more than it is reading.

If anything says it could not be placed, that is a comment the agent wrote and prreview could not
anchor — worth knowing, and worth telling me about.

Then: dismiss one. It should move to the dismissed lane, still readable, restorable. Re-run the
review — the dismissed one should not come back.

## 5. The diff, with comments on it

Back to **Diff**. The same comments are already there as balloons, where they land — no toggle to
find and flip, because a review you have paid for should not render only on request. `]` and `[`
should walk between them, and the file list should show a note count beside each file that carries
one. There should be **no explanations in the margin at all** — that is the point of the re-model.

Clicking a comment's location on the **Suggested comments** tab should land on that file *and*
leave that comment selected when it arrives.

## 6. Chat

Press `c`. Ask something the diff alone cannot answer: "who else calls this?", "is this
reachable from the public API?". The answer should come from the repository at the reviewed
revision, not from the diff.

## 7. Survival

Kill the server. Run the same command again. It should say `session: resumed`, and the topics,
the overview, the comments, your dismissal, and the chat history should all still be there.

## What to write down

For each of the three tabs: what was useful, what was noise, and one concrete example of each.
The noise matters more — precision is the only thing that makes a review tool worth opening
twice.

If a comment was **wrong**, keep it verbatim along with the code it pointed at. A confidently
wrong comment is the failure mode that costs trust in everything else on the page, and it is
worth more than ten correct ones as a signal about what to fix.
