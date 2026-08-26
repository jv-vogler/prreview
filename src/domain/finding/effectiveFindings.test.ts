import { describe, expect, it } from "vitest";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { StoredReview } from "../pass/StoredReview";
import { effectiveFindings } from "./effectiveFindings";

function storedReview(overrides: Partial<StoredReview> = {}): StoredReview {
	return {
		changesetId: "worktree",
		createdAt: "2026-08-22T00:00:00.000Z",
		headSha: null,
		pass: {
			overview: "x",
			verdict: "x",
			ticket: null,
			explanations: [],
			findings: [
				{
					path: "src/a.ts",
					startLine: 1,
					endLine: 1,
					kind: "defect",
					tier: "nitpick",
					title: "t",
					body: "original body",
					proof: "Inferred: x",
					verified: false,
					lane: "review",
				},
			],
		},
		residue: [],
		findingEdits: {},
		published: null,
		...overrides,
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

/** A finding, distinguishable from the fixture's default by its body. */
function finding(body: string) {
	return {
		path: "src/a.ts",
		startLine: 1,
		endLine: 1,
		kind: "defect" as const,
		tier: "nitpick" as const,
		title: "t",
		body,
		proof: "Inferred: x",
		verified: false,
		lane: "review" as const,
	};
}

describe("effectiveFindings", () => {
	it("resolves a stable id, placement and edited=false for an untouched finding", () => {
		const [finding] = effectiveFindings(storedReview(), [FILE]);
		expect(finding).toMatchObject({
			id: "finding-0",
			body: "original body",
			edited: false,
			placement: { kind: "exact", fileId: "file-1", side: "new", line: 1 },
		});
	});

	it("layers an edit's body on top without touching the underlying finding", () => {
		const stored = storedReview({
			findingEdits: { "finding-0": { body: "reworded" } },
		});
		const [finding] = effectiveFindings(stored, [FILE]);
		expect(finding).toMatchObject({ body: "reworded", edited: true });
	});

	it("tags a deleted finding rather than dropping it, so it can be restored", () => {
		const stored = storedReview({
			findingEdits: { "finding-0": { deleted: true } },
		});
		const [finding] = effectiveFindings(stored, [FILE]);
		expect(finding).toMatchObject({ id: "finding-0", deleted: true });
	});

	it("marks a finding unplaceable when its path is not in the diff", () => {
		const [finding] = effectiveFindings(storedReview(), []);
		expect(finding.placement).toEqual({ kind: "unplaceable" });
	});

	it("keeps an edit on its own finding when the pass is rebuilt in another order", () => {
		const stored = storedReview({
			pass: {
				overview: "x",
				verdict: "x",
				ticket: null,
				explanations: [],
				findings: [finding("the new one"), finding("the carried one")],
			},
			findingIds: ["finding-3", "finding-0"],
			findingEdits: { "finding-0": { body: "the reader's wording" } },
		});

		expect(effectiveFindings(stored, [FILE])).toEqual([
			expect.objectContaining({
				id: "finding-3",
				body: "the new one",
				edited: false,
			}),
			expect.objectContaining({
				id: "finding-0",
				body: "the reader's wording",
				edited: true,
			}),
		]);
	});
});
