import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import gitDiffParser from "gitdiff-parser";
import { beforeAll, describe, expect, it } from "vitest";
import {
	type Adjudication,
	adjudicate,
	type LensResult,
} from "../src/application/review/adjudicate";
import { buildProjectFrame } from "../src/application/review/projectFrame";
import { buildReviewOutSchema } from "../src/application/review/reviewSchemas";
import { buildLensTask } from "../src/application/review/reviewTask";
import type { ChangesetRef } from "../src/domain/changeset/ChangesetRef";
import { parseDiff } from "../src/domain/changeset/parseDiff";
import type { ReviewPreset } from "../src/domain/review/ReviewDepth";
import { depthForPreset } from "../src/domain/review/ReviewDepth";
import { TEST_WORKTREE_DIFF } from "./helpers/createTestApp";

/**
 * `scripts/mock-agent` is what makes the findings surface inspectable without
 * spending anything, and its whole value is that the board it produces puts
 * every state of the tab on screen at once. That is a claim which rots in
 * silence: the mock reads its caps and enums out of the `--json-schema` it is
 * handed and has to survive three gates it cannot see, so a change to the
 * confidence floor, the form gate, the grounding check, or the schema can leave
 * it emitting a board nobody notices is empty.
 *
 * So this drives the real pass — `buildLensTask` for the prompt, the mock as the
 * child process, `adjudicate` for the board — and asserts what a reader would
 * see. It is the same reasoning as `test/fakeClaude.test.ts`: a violation should
 * be a red test rather than a surface that quietly stops demonstrating anything.
 *
 * Nothing here spawns the real CLI, reaches the network, or costs anything.
 */

const MOCK = fileURLToPath(
	new URL("../scripts/mock-agent/claude", import.meta.url),
);
const WORKSPACE = "/tmp/prreview-mock-workspace";
const FILES = parseDiff(gitDiffParser.parse(TEST_WORKTREE_DIFF));

const REF: ChangesetRef = {
	source: { kind: "worktree" },
	baseSha: "a".repeat(40),
	headSha: null,
	resolvedAt: "2026-08-19T00:00:00.000Z",
};

/** the mock is spawned exactly as the engine spawns it: prompt on stdin, argv schema */
function askLens(
	preset: Exclude<ReviewPreset, "custom">,
	lens: string,
	options: { suppressions?: string[]; env?: Record<string, string> } = {},
): LensResult | null {
	const depth = depthForPreset(preset);
	const { task, input } = buildLensTask({
		lens: lens as never,
		depth,
		frame: buildProjectFrame({ files: FILES }),
		ref: REF,
		files: FILES,
		roundId: "r1",
		workspaceDir: WORKSPACE,
		resumeSessionId: null,
		suppressions: options.suppressions ?? [],
	});

	const child = spawnSync(
		process.execPath,
		[
			MOCK,
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--json-schema",
			task.jsonSchema,
		],
		{
			input: input.prompt,
			encoding: "utf8",
			env: { ...process.env, MOCK_AGENT_DELAY_MS: "0", ...options.env },
		},
	);
	expect(child.status).toBe(0);

	const frames = child.stdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, never>);
	const reads: { path: string }[] = [];
	for (const frame of frames) {
		const content = (frame.message as { content?: unknown[] } | undefined)
			?.content;
		for (const block of (content ?? []) as {
			type?: string;
			name?: string;
			input?: { file_path?: string };
		}[]) {
			if (block.type === "tool_use" && block.name === "Read") {
				reads.push({ path: block.input?.file_path ?? "" });
			}
		}
	}

	const result = frames.find((frame) => frame.type === "result");
	// the production gate, not a lenient one: the mock has to satisfy the same
	// zod schema a real answer does, including the caps it read off the schema
	const parsed = buildReviewOutSchema(depth).safeParse(
		(result as { structured_output?: unknown }).structured_output,
	);
	if (!parsed.success) {
		throw new Error(
			`the mock's ${lens} answer failed the schema: ${JSON.stringify(parsed.error.issues.slice(0, 2))}`,
		);
	}
	return {
		lens,
		out: parsed.data as LensResult["out"],
		readLog: { reads, searchHits: [] },
	};
}

function board(
	preset: Exclude<ReviewPreset, "custom">,
	options: { suppressions?: string[]; env?: Record<string, string> } = {},
): Adjudication {
	const depth = depthForPreset(preset);
	const results = depth.lenses
		.map((lens) => askLens(preset, lens, options))
		.filter((result): result is LensResult => result !== null);
	return adjudicate({ results, depth, files: FILES, workspaceDir: WORKSPACE });
}

describe("the mock agent's review board", () => {
	let standard: Adjudication;

	beforeAll(() => {
		standard = board("standard");
	});

	it("survives adjudication instead of being discarded whole", () => {
		// the failure this generator was written to fix: the lorem fallback emitted
		// `confidence: 0` (the schema's minimum) so the floor discarded every
		// single finding, and the tab rendered its empty state after a full run
		expect(standard.findings.length).toBeGreaterThan(3);
	});

	it("puts several severities and several categories on screen at once", () => {
		expect(
			new Set(standard.findings.map((f) => f.severity)).size,
		).toBeGreaterThan(2);
		expect(new Set(standard.findings.map((f) => f.category)).size).toBe(
			standard.findings.length,
		);
	});

	it("shows a finding corroborated by two lenses, ranked above a lone stronger one", () => {
		const merged = standard.findings.filter((f) => f.lenses.length > 1);
		expect(merged).toHaveLength(1);

		const mergedIndex = standard.findings.indexOf(merged[0] as never);
		const strongerSolo = standard.findings.findIndex(
			(f) =>
				f.lenses.length === 1 &&
				f.severity === merged[0]?.severity &&
				f.confidence > (merged[0]?.confidence ?? 0),
		);
		// corroboration outranks self-reported confidence, and here it is visible
		expect(strongerSolo).toBeGreaterThan(mergedIndex);
	});

	it("hedges exactly the finding whose citation nobody opened", () => {
		const hedged = standard.findings.filter((f) =>
			f.marks.some((mark) => mark.kind === "ungrounded-citation"),
		);
		expect(hedged).toHaveLength(1);
		expect(hedged[0]?.groundingVerified).toBe(false);
	});

	it("marks the inferred claims and leaves the traced ones unmarked", () => {
		expect(
			standard.findings.some((f) =>
				f.marks.some((mark) => mark.kind === "inferred-path"),
			),
		).toBe(true);
		expect(standard.findings.some((f) => f.marks.length === 0)).toBe(true);
	});

	/**
	 * `fresh-eyes` reads nothing — that is what the lens is — so its lead is
	 * grounded only through the union of the round's logs. If the union rule ever
	 * breaks, this is the finding that disappears.
	 */
	it("keeps the context-free lead, grounded through the union log", () => {
		const lead = standard.findings.find((f) => f.lenses.includes("fresh-eyes"));
		expect(lead?.groundingVerified).toBe(true);
		expect(lead?.proof.mode).toBe("inferred");
	});

	it("carries a repro test and a citation on at least one card", () => {
		expect(standard.findings.some((f) => f.reproTest !== undefined)).toBe(true);
		expect(standard.findings.some((f) => f.citations.length > 0)).toBe(true);
	});

	it("puts the pre-existing problems in their own lane", () => {
		expect(standard.relatedFindings.length).toBeGreaterThan(1);
	});

	it("gets something killed by each gate, so the discard section has real counts", () => {
		const kinds = standard.discarded.map((entry) => entry.reason.kind);
		expect(kinds).toContain("below-confidence-floor");
		expect(kinds).toContain("form");
		expect(kinds).toContain("ungrounded-blocker");
		// one reason with a count above one, so the grouping is worth looking at
		expect(
			kinds.filter((kind) => kind === "below-confidence-floor").length,
		).toBeGreaterThan(1);
	});

	it("gates the related lane the same way it gates the findings", () => {
		expect(
			standard.discarded.some((entry) => entry.species === "related-finding"),
		).toBe(true);
	});

	/**
	 * A dismissed comment must not come back next round. It is the one half of
	 * the curation loop a generator can demonstrate — nothing it emits can set
	 * `curation.state` itself.
	 */
	it("does not raise a comment the reviewer already dismissed", () => {
		const first = standard.findings[0];
		if (first === undefined) {
			throw new Error("expected a board to dismiss from");
		}
		const after = board("standard", { suppressions: [first.title] });

		expect(after.findings.map((f) => f.title)).not.toContain(first.title);
		expect(after.findings.length).toBe(standard.findings.length - 1);
	});

	it("renders a board at light, where two lenses run and nitpick does not exist", () => {
		const light = board("light");

		expect(light.findings.length).toBeGreaterThan(2);
		expect(light.findings.map((f) => f.severity)).not.toContain("nitpick");
		expect(light.findings.every((f) => f.lenses.length <= 2)).toBe(true);
	});

	it("gives the sixth lens something to say at thorough", () => {
		const thorough = board("thorough");

		expect(thorough.findings.some((f) => f.lenses.includes("impact"))).toBe(
			true,
		);
	});

	/** the empty state, which is otherwise only reachable by hoping for it */
	it("can find nothing at all on request", () => {
		const silent = board("standard", { env: { MOCK_AGENT_REVIEW: "silent" } });

		expect(silent.findings).toEqual([]);
		expect(silent.relatedFindings).toEqual([]);
		expect(silent.discarded).toEqual([]);
	});
});

describe("the mock agent's narration", () => {
	/**
	 * The read log used to be one hardcoded `src/index.ts` for every
	 * non-comprehension task — a path not in the changeset and not
	 * workspace-absolute. So `checkGrounding` failed for every finding, every
	 * blocker was dropped, and nothing survived even with a valid confidence.
	 */
	it("reads paths that are actually in the changeset", () => {
		const result = askLens("standard", "correctness");
		const paths = (result?.readLog.reads ?? []).map((read) => read.path);

		expect(paths.length).toBeGreaterThan(0);
		for (const path of paths) {
			expect(path.startsWith(`${WORKSPACE}/`)).toBe(true);
			expect(FILES.some((file) => path.endsWith(`/${file.path}`))).toBe(true);
		}
	});

	it("has the fresh-eyes lens read nothing at all", () => {
		expect(askLens("standard", "fresh-eyes")?.readLog.reads).toEqual([]);
	});
});
