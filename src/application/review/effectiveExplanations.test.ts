import { describe, expect, it } from "vitest";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { StoredReview } from "../ports/SessionStore";
import { effectiveExplanations } from "./effectiveExplanations";
import type { ReviewExplanation } from "./reviewSchema";

function storedReview(explanations: ReviewExplanation[]): StoredReview {
	return {
		changesetId: "worktree",
		createdAt: "2026-08-22T00:00:00.000Z",
		headSha: null,
		pass: {
			overview: "x",
			verdict: "x",
			ticket: null,
			explanations,
			findings: [],
		},
		residue: [],
		commentEdits: {},
		published: null,
	};
}

const FILE: FileDiff = {
	id: "file-1",
	path: "src/a.ts",
	status: "modified",
	additions: 1,
	deletions: 0,
	isBinary: false,
	isGenerated: false,
	oldBlob: null,
	newBlob: null,
	hunks: [
		{
			id: "hunk-1",
			header: "",
			oldStart: 1,
			oldLines: 0,
			newStart: 1,
			newLines: 1,
			lines: [{ type: "add", content: "x", newLine: 1 }],
		},
	],
};

describe("effectiveExplanations", () => {
	it("resolves a positional id and an exact placement through placeComment", () => {
		const [explanation] = effectiveExplanations(
			storedReview([
				{
					path: "src/a.ts",
					startLine: 1,
					endLine: 1,
					says: ["The change now does this."],
					topic: "one intent",
				},
			]),
			[FILE],
		);
		expect(explanation).toEqual({
			id: "explanation-0",
			path: "src/a.ts",
			startLine: 1,
			endLine: 1,
			says: ["The change now does this."],
			topic: "one intent",
			placement: { kind: "exact", fileId: "file-1", side: "new", line: 1 },
		});
	});

	it("keeps an unplaceable explanation, placement and all, rather than dropping it", () => {
		const explanations = effectiveExplanations(
			storedReview([
				{
					path: "not/in/diff.ts",
					startLine: 1,
					endLine: 1,
					says: ["Still reaches the wire."],
				},
			]),
			[FILE],
		);
		expect(explanations).toHaveLength(1);
		expect(explanations[0].placement).toEqual({ kind: "unplaceable" });
		expect(explanations[0].topic).toBeUndefined();
	});
});
