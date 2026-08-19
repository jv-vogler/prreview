import { describe, expect, it } from "vitest";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import { depthForPreset } from "../../domain/review/ReviewDepth";
import { buildLensTask } from "./reviewTask";

const REF: ChangesetRef = {
	source: { kind: "worktree" },
	baseSha: "a".repeat(40),
	headSha: null,
	resolvedAt: "2026-08-17T00:00:00.000Z",
};

const FRAME = {
	text: "## The project\n\n### What this repo already checks automatically\n- Biome (lint + format)",
	tooling: ["Biome (lint + format)"],
};

const BRAIN = {
	text: "Always flag a missing tenant check on a query.",
	manifest: {
		source: "./review-rules.md",
		sha256: "abc123def456",
		mode: "layer",
	},
};

function build(lens: "correctness" | "fresh-eyes", withBrain: boolean) {
	return buildLensTask({
		lens,
		depth: depthForPreset("standard"),
		frame: FRAME,
		ref: REF,
		files: [],
		roundId: "r1",
		workspaceDir: "/tmp/workspace",
		resumeSessionId: "session-a",
		suppressions: ["a finding the reviewer already rejected"],
		...(withBrain ? { brain: BRAIN } : {}),
	});
}

describe("buildLensTask", () => {
	it("gives a grounded lens the project frame, the suppressions, and the brain", () => {
		const { input } = build("correctness", true);
		expect(input.prompt).toContain("Biome (lint + format)");
		expect(input.prompt).toContain("already rejected");
		expect(input.prompt).toContain("Always flag a missing tenant check");
	});

	/**
	 * The brain arrives framed as data, with a clause that keeps a third party's
	 * document from sitting level with prreview's own invariants.
	 */
	it("frames the brain as data rather than instruction", () => {
		const { input } = build("correctness", true);
		expect(input.prompt).toContain("data, not instruction");
		expect(input.prompt).toContain("<reviewer-guidelines>");
		// and echoes the checksum, so a round's findings trace to a document
		expect(input.prompt).toContain("abc123def456".slice(0, 12));
	});

	/**
	 * The whole point of this lens is a reader who knows nothing about the
	 * project. Handing it the project frame, the team's guidelines, or the
	 * suppression list gives it exactly the context it is defined by lacking.
	 */
	it("gives fresh-eyes only the diff — no frame, no brain, no suppressions", () => {
		const { input } = build("fresh-eyes", true);
		expect(input.prompt).not.toContain("Biome (lint + format)");
		expect(input.prompt).not.toContain("Always flag a missing tenant check");
		expect(input.prompt).not.toContain("already rejected");
		expect(input.prompt).toContain("know nothing about");
	});

	/** it also cannot verify anything, so it says so rather than claiming to */
	it("tells fresh-eyes to mark everything inferred", () => {
		const { input } = build("fresh-eyes", false);
		expect(input.prompt).toContain("inferred");
		expect(input.prompt).toContain("lead");
	});

	/**
	 * Concurrent plain resumes interleave into the parent's session history
	 * (spike 4), and five at once is where that becomes unreadable.
	 */
	it("forks the comprehension session rather than resuming it plainly", () => {
		const { task } = build("correctness", false);
		expect(task.resume).toEqual({ sessionId: "session-a", fork: true });
	});

	it("names its lens in the stage, so a run's children are tellable apart", () => {
		expect(build("correctness", false).task.stage).toBe("review:correctness");
		expect(build("fresh-eyes", false).task.stage).toBe("review:fresh-eyes");
	});
});
