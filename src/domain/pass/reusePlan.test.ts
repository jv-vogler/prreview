import { describe, expect, it } from "vitest";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { checkpointOf, planReuse } from "./reusePlan";
import type { ReviewFinding } from "./reviewSchema";
import type { ReviewCheckpoint, StoredReview } from "./StoredReview";

const BASE_SHA = "a".repeat(40);
const MOVED_BASE_SHA = "b".repeat(40);

function file(
	path: string,
	oldOid: string | null,
	newOid: string | null,
): FileDiff {
	return {
		id: `file-${path}`,
		path,
		status: "modified",
		additions: 1,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: oldOid === null ? null : { kind: "odb", oid: oldOid },
		newBlob: newOid === null ? null : { kind: "odb", oid: newOid },
		hunks: [],
	};
}

function finding(
	path: string,
	overrides: Partial<ReviewFinding> = {},
): ReviewFinding {
	return {
		path,
		startLine: 1,
		endLine: 1,
		kind: "defect",
		tier: "nitpick",
		title: `finding on ${path}`,
		body: "x",
		proof: "Inferred: x",
		verified: false,
		lane: "review",
		...overrides,
	} as ReviewFinding;
}

function stored(
	findings: ReviewFinding[],
	overrides: Partial<StoredReview> = {},
): StoredReview {
	return {
		changesetId: "worktree",
		createdAt: "2026-08-22T00:00:00.000Z",
		headSha: null,
		pass: {
			overview: "x",
			verdict: "x",
			ticket: null,
			explanations: [],
			findings,
		},
		residue: [],
		findingEdits: {},
		published: null,
		...overrides,
	};
}

const CHECKPOINT: ReviewCheckpoint = {
	baseSha: BASE_SHA,
	headSha: null,
	files: [
		{ path: "src/kept.ts", oldOid: "k1", newOid: "k2" },
		{ path: "src/edited.ts", oldOid: "e1", newOid: "e2" },
		{ path: "src/gone.ts", oldOid: "g1", newOid: "g2" },
	],
};

const CURRENT = [
	file("src/kept.ts", "k1", "k2"),
	file("src/edited.ts", "e1", "e3"),
	file("src/new.ts", null, "n1"),
];

describe("planReuse", () => {
	it("sorts each file by whether its diff is the same byte for byte", () => {
		const plan = planReuse(
			CHECKPOINT,
			{ baseSha: BASE_SHA, files: CURRENT },
			stored([]),
		);

		expect(plan.unchanged.map((entry) => entry.path)).toEqual(["src/kept.ts"]);
		expect(plan.changed.map((entry) => entry.path)).toEqual(["src/edited.ts"]);
		expect(plan.added.map((entry) => entry.path)).toEqual(["src/new.ts"]);
		expect(plan.removed).toEqual(["src/gone.ts"]);
		expect(plan.baseMoved).toBe(false);
	});

	it("reports a base that has moved without changing what is reusable", () => {
		const plan = planReuse(
			CHECKPOINT,
			{ baseSha: MOVED_BASE_SHA, files: CURRENT },
			stored([]),
		);

		expect(plan.baseMoved).toBe(true);
		expect(plan.unchanged.map((entry) => entry.path)).toEqual(["src/kept.ts"]);
	});

	it("carries only findings on unchanged files", () => {
		const plan = planReuse(
			CHECKPOINT,
			{ baseSha: BASE_SHA, files: CURRENT },
			stored([
				finding("src/kept.ts", { dependsOn: [] }),
				finding("src/edited.ts", { dependsOn: [] }),
				finding("src/new.ts", { dependsOn: [] }),
			]),
		);

		expect(plan.carried.map((entry) => entry.id)).toEqual(["finding-0"]);
		expect(plan.recheck).toEqual([]);
	});

	it("leaves a dismissed finding out: carrying it would put it back", () => {
		const plan = planReuse(
			CHECKPOINT,
			{ baseSha: BASE_SHA, files: CURRENT },
			stored([finding("src/kept.ts", { dependsOn: [] })], {
				findingEdits: { "finding-0": { deleted: true } },
			}),
		);

		expect(plan.carried).toEqual([]);
	});

	it("re-checks a carried finding when something it leaned on moved", () => {
		const plan = planReuse(
			CHECKPOINT,
			{ baseSha: BASE_SHA, files: CURRENT },
			stored([
				finding("src/kept.ts", { dependsOn: ["src/edited.ts"] }),
				finding("src/kept.ts", { dependsOn: ["src/gone.ts"] }),
				finding("src/kept.ts", { dependsOn: ["src/new.ts"] }),
				finding("src/kept.ts", { dependsOn: ["src/kept.ts"] }),
			]),
		);

		expect(plan.recheck.map((entry) => entry.id)).toEqual([
			"finding-0",
			"finding-1",
			"finding-2",
		]);
		expect(plan.recheck[0]?.movedDependencies).toEqual(["src/edited.ts"]);
	});

	it("re-checks a finding that recorded nothing it leaned on", () => {
		const plan = planReuse(
			CHECKPOINT,
			{ baseSha: BASE_SHA, files: CURRENT },
			stored([finding("src/kept.ts")]),
		);

		expect(plan.recheck.map((entry) => entry.id)).toEqual(["finding-0"]);
		expect(plan.recheck[0]).toMatchObject({
			unrecorded: true,
			movedDependencies: [],
		});
	});

	it("names carried findings by the ids the pass stored, not their positions", () => {
		const plan = planReuse(
			CHECKPOINT,
			{ baseSha: BASE_SHA, files: CURRENT },
			stored(
				[finding("src/edited.ts"), finding("src/kept.ts", { dependsOn: [] })],
				{ findingIds: ["finding-7", "finding-4"] },
			),
		);

		expect(plan.carried.map((entry) => entry.id)).toEqual(["finding-4"]);
	});
});

describe("checkpointOf", () => {
	it("records the blob pair planReuse reads back", () => {
		const checkpoint = checkpointOf(
			{ baseSha: BASE_SHA, files: CURRENT },
			null,
		);

		expect(checkpoint).toEqual({
			baseSha: BASE_SHA,
			headSha: null,
			files: [
				{ path: "src/kept.ts", oldOid: "k1", newOid: "k2" },
				{ path: "src/edited.ts", oldOid: "e1", newOid: "e3" },
				{ path: "src/new.ts", oldOid: null, newOid: "n1" },
			],
		});
	});

	it("round-trips: a changeset checkpointed against itself has nothing moved", () => {
		const checkpoint = checkpointOf(
			{ baseSha: BASE_SHA, files: CURRENT },
			null,
		);
		const plan = planReuse(
			checkpoint,
			{ baseSha: BASE_SHA, files: CURRENT },
			stored([]),
		);

		expect(plan.changed).toEqual([]);
		expect(plan.added).toEqual([]);
		expect(plan.removed).toEqual([]);
		expect(plan.unchanged).toHaveLength(3);
	});
});
