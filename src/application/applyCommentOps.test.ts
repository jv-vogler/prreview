import { describe, expect, it } from "vitest";
import { FakeSessionStore } from "../../test/helpers/FakeSessionStore";
import { applyCommentOps } from "./applyCommentOps";
import type { StoredReview } from "./ports/SessionStore";

const CHANGESET_ID = "worktree";

function storedReview(): StoredReview {
	return {
		changesetId: CHANGESET_ID,
		createdAt: "2026-08-22T00:00:00.000Z",
		pass: {
			overview: "x",
			verdict: "x",
			ticket: null,
			qualityPoints: [],
			findings: [
				{
					path: "src/a.ts",
					startLine: 1,
					endLine: 1,
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
		commentEdits: {},
	};
}

describe("applyCommentOps", () => {
	it("overwrites a comment's body and persists it", async () => {
		const store = new FakeSessionStore();
		await store.saveReview(storedReview());

		const updated = await applyCommentOps(
			{ sessionStore: store },
			CHANGESET_ID,
			{ kind: "edit", commentId: "finding-0", body: "reworded" },
		);

		expect(updated.commentEdits["finding-0"]).toEqual({ body: "reworded" });
		expect(await store.loadReview(CHANGESET_ID)).toEqual(updated);
	});

	it("marks a comment deleted, then restore clears it", async () => {
		const store = new FakeSessionStore();
		await store.saveReview(storedReview());

		const deleted = await applyCommentOps(
			{ sessionStore: store },
			CHANGESET_ID,
			{ kind: "delete", commentId: "finding-0" },
		);
		expect(deleted.commentEdits["finding-0"]).toEqual({ deleted: true });

		const restored = await applyCommentOps(
			{ sessionStore: store },
			CHANGESET_ID,
			{ kind: "restore", commentId: "finding-0" },
		);
		expect(restored.commentEdits["finding-0"]).toEqual({ deleted: false });
	});

	it("keeps an edited body across a later delete", async () => {
		const store = new FakeSessionStore();
		await store.saveReview(storedReview());
		await applyCommentOps({ sessionStore: store }, CHANGESET_ID, {
			kind: "edit",
			commentId: "finding-0",
			body: "reworded",
		});

		const deleted = await applyCommentOps(
			{ sessionStore: store },
			CHANGESET_ID,
			{ kind: "delete", commentId: "finding-0" },
		);

		expect(deleted.commentEdits["finding-0"]).toEqual({
			body: "reworded",
			deleted: true,
		});
	});

	it("rejects an id belonging to no finding in the pass", async () => {
		const store = new FakeSessionStore();
		await store.saveReview(storedReview());

		await expect(
			applyCommentOps({ sessionStore: store }, CHANGESET_ID, {
				kind: "edit",
				commentId: "finding-7",
				body: "x",
			}),
		).rejects.toMatchObject({ reason: "comment-not-found" });
	});

	it("rejects a changeset with no saved pass at all", async () => {
		const store = new FakeSessionStore();

		await expect(
			applyCommentOps({ sessionStore: store }, CHANGESET_ID, {
				kind: "delete",
				commentId: "finding-0",
			}),
		).rejects.toMatchObject({ reason: "no-review" });
	});
});
