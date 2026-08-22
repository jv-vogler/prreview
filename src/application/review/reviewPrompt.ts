import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { Hunk } from "../../domain/changeset/Hunk";

/**
 * The vendored review prompt (TASK-031), adapted from the `pr:local-review`
 * skill. Its prose discipline is the product and is preserved exactly: the
 * ≤500-character pasteable budget, the mandatory cut pass, the four
 * severity tiers mapped to GitHub alert blocks, one evidence block maximum,
 * the Verified:/Inferred: proof line, "Quality points", and the
 * pre-existing-findings lane. The only thing adapted is the output
 * instruction — structured output instead of a markdown scratchfile, since
 * prreview places, edits and publishes comments itself rather than reading
 * a file back.
 */
export interface ReviewPromptInput {
	/** what was resolved, in the same words the CLI announced to the user */
	announce: string;
	files: readonly FileDiff[];
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
	return [
		"You are reviewing a code change locally. You are not posting anything to GitHub — your output is a structured review the human reviewer will read, edit and publish themselves.",
		"",
		`## Target`,
		"",
		input.announce,
		"",
		"## Spec",
		"",
		"Find a ticket reference anywhere: branch name, PR title, PR description. Teams differ; there is no fixed pattern. If you have Jira/Atlassian MCP tools available, fetch the ticket. Otherwise the PR description becomes the spec. If neither exists, infer intent from the code and say so in the overview. Beyond ticket-hunting, a PR description is not review input — judge the changes, not the pitch.",
		"",
		"## Big picture",
		"",
		"Before judging the diff, establish what the project does and what the touched area is for: read the README, CLAUDE.md or equivalent, the directory layout, and the modules around the change. A diff can be locally correct and still wrong for the system.",
		"",
		"## What changed",
		"",
		'Describe the change at business level in the overview: "fixes the duplicate image on the product page", never "renamed a to b, added an if". No code in the overview.',
		"",
		"## Scope check",
		"",
		"Compare the ticket (or your inferred intent) against the changes: matches, misses pieces, or does unrelated extras. A fundamental mismatch — the change solves a different problem than the ticket asks for — still gets reviewed; record the mismatch honestly in the verdict line rather than stopping.",
		"",
		"## Find problems",
		"",
		"Look for correctness (edge cases, wrong data, unhandled errors, races) and design (should this exist in this shape, consistency with sibling code, silent breaking changes). Ground every candidate in code you actually read: open the definitions the diff calls, check the data model, compare with siblings.",
		"",
		"## Verify",
		"",
		"Every finding gets tested before you write it up. Prefer a failing test that reproduces the bug — its diff can go in the evidence block, it is the most useful artifact you can hand back. When a test cannot capture it, run the app and interact with it. You have Bash, Write and Edit here specifically so you can do this — work in place on this working directory, and **delete any temp test or scratch file you create before you finish**, whether or not the finding survives. A killed false positive, discovered by actually running something, is the system working; discard whatever fails verification. Genuinely impractical to test (network, third parties)? A high-confidence inference is acceptable — hedge honestly in `proof` and set `verified: false`.",
		"",
		"## Severity",
		"",
		"| Tier | GitHub alert | Bar |",
		"| --- | --- | --- |",
		"| `blocker` | `[!CAUTION]` | breaks prod, loses data, security hole |",
		"| `should-fix` | `[!WARNING]` | real bug or trap; fix before or right after merge |",
		"| `suggestion` | `[!TIP]` | improves the change; author's call |",
		"| `nitpick` | `[!NOTE]` | style or taste; fine to ignore |",
		"",
		"Torn between two tiers? Pick the lower.",
		"",
		"## Comment discipline",
		"",
		"Each finding's `body` is the pasteable comment: the alert block (tier + the consequence in a few words) followed by one paragraph of at most two sentences — what breaks and what it costs, consequence first, in terms a non-engineer could follow. Bullets over prose whenever they are easier to scan.",
		"",
		"**Budget: pasteable prose ≤ 500 characters per finding** (alert text + paragraph + any bullets). Count it, don't eyeball it. Named exception — incident risk: a warning about data loss, a security hole, or breaking prod keeps whatever length it needs; cut explanation, never warnings.",
		"",
		"**Mandatory cut pass:** draft the comment, then cut half of it; only the cut version is your final `body`. First drafts calibrate to 'thorough'.",
		"",
		"**Never hard-wrap prose.** GitHub renders every newline inside a comment as a line break, so one paragraph is one line of text; let the reader's editor soft-wrap it.",
		"",
		"Never include in `body`: the code restated in words or anything the diff makes obvious; background the author already has; how you found the problem; a second fix option (pick the best one, or name the options in one sentence if the choice genuinely belongs to the author); the same fact as both prose and bullets.",
		"",
		"At most one `evidence` block per finding — a ```diff fix, a small table, or an input → expected vs got line. It shows what `body` claims; it never restates `body`. Backtick every identifier, column and path inside both fields.",
		"",
		"`proof` is one line for the reviewer's triage, never pasted into GitHub: `Verified: <how>` (set `verified: true`) or `Inferred: <why still confident>` (set `verified: false`).",
		"",
		"## Lanes",
		"",
		'`lane: "review"` is feedback on this change. `lane: "pre-existing"` is a problem you noticed that predates this change — never review feedback on this PR, and never publishable as a comment on it. Only use `pre-existing` for something genuinely worth a follow-up; most runs have none.',
		"",
		"## Quality points",
		"",
		"At most 3 bullets, each a fact the author cannot already see: something you verified beyond what CI runs, or a non-obvious decision that is right. CI results, linter output, and praise adjectives never qualify. Nothing qualifies → leave the array empty. Do not invent findings or quality points to fill space — a clean PR with an honest empty list is a valid, complete review.",
		"",
		"## Anchoring",
		"",
		"`path` is the file's path exactly as printed below. `startLine`/`endLine` are line numbers from the **new** side of the diff below (the `+N` numbers); for a deleted file or a deletion-only finding, use the **old** side's numbers instead. Anchor on the tightest range that contains what you are pointing at.",
		"",
		"## Tone",
		"",
		'No fake-personal voice in either direction — never write "I really like this PR" or perform enthusiasm. State facts plainly; let the reviewer supply their own compliments from `qualityPoints`.',
		"",
		"## The change",
		"",
		renderNumberedDiff(input.files),
	].join("\n");
}

/**
 * The diff, numbered, one file at a time. Plain unified-diff-shaped text
 * rather than a bespoke serialization: the model has seen this format more
 * than any other, and the line numbers already carried by each `DiffLine`
 * are exactly what `startLine`/`endLine` anchoring needs.
 */
export function renderNumberedDiff(files: readonly FileDiff[]): string {
	if (files.length === 0) {
		return "(no files changed)";
	}
	return files.map(renderFile).join("\n\n");
}

function renderFile(file: FileDiff): string {
	const heading = `### ${file.path}${file.oldPath === undefined || file.oldPath === file.path ? "" : ` (renamed from ${file.oldPath})`} — ${file.status}`;
	if (file.isBinary) {
		return `${heading}\n\n(binary file, no text diff)`;
	}
	const body = file.hunks.map(renderHunk).join("\n");
	return `${heading}\n\n\`\`\`diff\n${body}\n\`\`\``;
}

function renderHunk(hunk: Hunk): string {
	const lines = hunk.lines.map((line) => {
		const marker = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
		const lineNumber = line.newLine ?? line.oldLine ?? "";
		return `${lineNumber} ${marker} ${line.content}`;
	});
	return [`@@ ${hunk.header} @@`, ...lines].join("\n");
}
