import { describe, expect, it } from "vitest";
import { FakeGithubService } from "../../test/helpers/FakeGithubService";
import { FakeSessionStore } from "../../test/helpers/FakeSessionStore";
import type { ChangesetSource } from "../domain/changeset/ChangesetSource";
import type { FileDiff } from "../domain/changeset/FileDiff";
import type { StoredReview } from "./ports/SessionStore";
import { buildPublishPayload, publishReview } from "./publishReview";
import type { EffectiveComment } from "./review/effectiveComments";
import type { ReviewFinding } from "./review/reviewSchema";

const CHANGESET_ID = "pr:acme/api#42";
const PR_SOURCE: ChangesetSource = { kind: "pr", repo: "acme/api", number: 42 };

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
	return {
		path: "src/a.ts",
		startLine: 1,
		endLine: 1,
		kind: "defect",
		tier: "nitpick",
		title: "t",
		body: "a finding",
		proof: "Inferred: x",
		verified: false,
		lane: "review",
		...overrides,
	};
}

function storedReview(overrides: Partial<StoredReview> = {}): StoredReview {
	return {
		changesetId: CHANGESET_ID,
		createdAt: "2026-08-22T00:00:00.000Z",
		headSha: null,
		pass: {
			overview: "x",
			verdict: "x",
			ticket: null,
			explanations: [],
			findings: [finding()],
		},
		residue: [],
		commentEdits: {},
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
			newLines: 3,
			lines: [
				{ type: "add", content: "one", newLine: 1 },
				{ type: "add", content: "two", newLine: 2 },
				{ type: "add", content: "three", newLine: 3 },
			],
		},
	],
};

function effective(
	overrides: Partial<EffectiveComment> = {},
): EffectiveComment {
	return {
		id: "finding-0",
		path: "src/a.ts",
		startLine: 1,
		endLine: 1,
		kind: "defect",
		tier: "nitpick",
		title: "t",
		body: "a finding",
		proof: "Inferred: x",
		verified: false,
		lane: "review",
		placement: { kind: "exact", fileId: "file-1", side: "new", line: 1 },
		edited: false,
		deleted: false,
		...overrides,
	};
}

describe("buildPublishPayload", () => {
	it("excludes a pre-existing-lane comment, reporting why", () => {
		const { included, excluded } = buildPublishPayload([
			effective({ lane: "pre-existing" }),
		]);
		expect(included).toEqual([]);
		expect(excluded).toEqual([{ id: "finding-0", reason: "pre-existing" }]);
	});

	it("excludes an unplaceable comment, reporting why", () => {
		const { included, excluded } = buildPublishPayload([
			effective({ placement: { kind: "unplaceable" } }),
		]);
		expect(included).toEqual([]);
		expect(excluded).toEqual([{ id: "finding-0", reason: "unplaceable" }]);
	});

	it("sends a single-line exact placement with no range", () => {
		const { included } = buildPublishPayload([effective()]);
		expect(included).toEqual([
			{
				id: "finding-0",
				wire: { path: "src/a.ts", line: 1, side: "RIGHT", body: "a finding" },
			},
		]);
	});

	it("pastes the visual aid under the body, leaving title and proof behind", () => {
		const { included } = buildPublishPayload([
			effective({ evidence: "```diff\n-  old\n+  new\n```" }),
		]);
		expect(included[0].wire.body).toBe(
			"a finding\n\n```diff\n-  old\n+  new\n```",
		);
	});

	// a question is asked the way a human asks it: the body is the question,
	// with no tier to announce and so no alert block to carry
	it("publishes a question as its body alone, no alert block added", () => {
		const { included } = buildPublishPayload([
			effective({
				kind: "question",
				tier: undefined,
				body: "Why the second lookup here instead of reusing the cached row?",
			}),
		]);
		expect(included[0].wire.body).toBe(
			"Why the second lookup here instead of reusing the cached row?",
		);
	});

	it("carries a genuine multi-line exact placement as a range", () => {
		const { included } = buildPublishPayload([
			effective({
				startLine: 1,
				endLine: 3,
				placement: { kind: "exact", fileId: "file-1", side: "new", line: 3 },
			}),
		]);
		expect(included[0].wire).toEqual({
			path: "src/a.ts",
			line: 3,
			side: "RIGHT",
			startLine: 1,
			startSide: "RIGHT",
			body: "a finding",
		});
	});

	it("sends a clamped placement as its single nearest line, never the requested range", () => {
		const { included } = buildPublishPayload([
			effective({
				startLine: 1,
				endLine: 40,
				placement: {
					kind: "clamped",
					fileId: "file-1",
					side: "old",
					line: 12,
					requestedStartLine: 1,
					requestedEndLine: 40,
				},
			}),
		]);
		expect(included[0].wire).toEqual({
			path: "src/a.ts",
			line: 12,
			side: "LEFT",
			body: "a finding",
		});
	});
});

describe("publishReview", () => {
	it("refuses when there is no GitHub backend", async () => {
		await expect(
			publishReview(
				{ githubService: null, sessionStore: new FakeSessionStore() },
				CHANGESET_ID,
				PR_SOURCE,
				[FILE],
			),
		).rejects.toMatchObject({ reason: "no-github" });
	});

	it("refuses a changeset that is not a pull request", async () => {
		await expect(
			publishReview(
				{
					githubService: new FakeGithubService(),
					sessionStore: new FakeSessionStore(),
				},
				"worktree",
				{ kind: "worktree" },
				[FILE],
			),
		).rejects.toMatchObject({ reason: "not-a-pull-request" });
	});

	it("refuses when no review pass has run yet", async () => {
		await expect(
			publishReview(
				{
					githubService: new FakeGithubService(),
					sessionStore: new FakeSessionStore(),
				},
				CHANGESET_ID,
				PR_SOURCE,
				[FILE],
			),
		).rejects.toMatchObject({ reason: "no-review" });
	});

	it("refuses when every finding is excluded", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview(
			storedReview({
				pass: {
					overview: "x",
					verdict: "x",
					ticket: null,
					explanations: [],
					findings: [finding({ lane: "pre-existing" })],
				},
			}),
		);
		await expect(
			publishReview(
				{ githubService: new FakeGithubService(), sessionStore },
				CHANGESET_ID,
				PR_SOURCE,
				[FILE],
			),
		).rejects.toMatchObject({ reason: "nothing-publishable" });
	});

	it("refuses when the only finding has been dismissed", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview(
			storedReview({ commentEdits: { "finding-0": { deleted: true } } }),
		);
		await expect(
			publishReview(
				{ githubService: new FakeGithubService(), sessionStore },
				CHANGESET_ID,
				PR_SOURCE,
				[FILE],
			),
		).rejects.toMatchObject({ reason: "nothing-publishable" });
	});

	it("publishes the placeable review-lane comments and records the result", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview(
			storedReview({
				pass: {
					overview: "x",
					verdict: "x",
					ticket: null,
					explanations: [],
					findings: [
						finding({ path: "src/a.ts", startLine: 1, endLine: 1 }),
						finding({ path: "src/missing.ts", lane: "review" }),
						finding({ lane: "pre-existing" }),
					],
				},
			}),
		);
		const githubService = new FakeGithubService();

		const result = await publishReview(
			{ githubService, sessionStore },
			CHANGESET_ID,
			PR_SOURCE,
			[FILE],
		);

		expect(githubService.createdReviews).toHaveLength(1);
		expect(githubService.createdReviews[0]).toEqual({
			pr: 42,
			input: {
				comments: [
					{ path: "src/a.ts", line: 1, side: "RIGHT", body: "a finding" },
				],
			},
		});
		expect(result.published).toEqual({
			reviewId: 1,
			htmlUrl: "https://example.invalid/pull/1#review-1",
			publishedAt: expect.any(String),
			commentIds: ["finding-0"],
		});
		// the artifact itself is untouched — a second pass stays possible
		expect(result.pass.findings).toHaveLength(3);
	});

	it("publishes none of a pass's explanations, however placeable they are", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview(
			storedReview({
				pass: {
					overview: "x",
					verdict: "x",
					ticket: null,
					explanations: [
						{
							path: "src/a.ts",
							startLine: 1,
							endLine: 1,
							says: ["An account of the change, not a comment."],
							grounding: "inferred",
							topic: "a topic",
						},
					],
					findings: [finding()],
				},
			}),
		);
		const githubService = new FakeGithubService();

		const result = await publishReview(
			{ githubService, sessionStore },
			CHANGESET_ID,
			PR_SOURCE,
			[FILE],
		);

		expect(githubService.createdReviews[0].input.comments).toEqual([
			{ path: "src/a.ts", line: 1, side: "RIGHT", body: "a finding" },
		]);
		expect(result.published?.commentIds).toEqual(["finding-0"]);
	});

	it("discards a previously published pending review before creating the new one", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview(
			storedReview({
				published: {
					reviewId: 7,
					htmlUrl: "https://example.invalid/pull/1#review-7",
					publishedAt: "2026-08-21T00:00:00.000Z",
					commentIds: ["finding-0"],
				},
			}),
		);
		const githubService = new FakeGithubService();

		await publishReview(
			{ githubService, sessionStore },
			CHANGESET_ID,
			PR_SOURCE,
			[FILE],
		);

		expect(githubService.deletedReviews).toEqual([{ pr: 42, id: 7 }]);
	});

	it("still publishes when the previously tracked pending review is already gone", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview(
			storedReview({
				published: {
					reviewId: 7,
					htmlUrl: "https://example.invalid/pull/1#review-7",
					publishedAt: "2026-08-21T00:00:00.000Z",
					commentIds: ["finding-0"],
				},
			}),
		);
		const githubService = new FakeGithubService();
		githubService.deletePendingReview = async () => {
			throw new Error("404 not found");
		};

		const result = await publishReview(
			{ githubService, sessionStore },
			CHANGESET_ID,
			PR_SOURCE,
			[FILE],
		);

		expect(result.published?.reviewId).toBe(1);
	});
});
