import { describe, expect, it } from "vitest";
import { FakeSessionStore } from "../../test/helpers/FakeSessionStore";
import type { StoredReview } from "../domain/pass/StoredReview";
import { applyFindingOps } from "./applyFindingOps";

const CHANGESET_ID = "worktree";

function storedReview(): StoredReview {
	return {
		changesetId: CHANGESET_ID,
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
	};
}

describe("applyFindingOps", () => {
	it("overwrites a comment's body and persists it", async () => {
		const store = new FakeSessionStore();
		await store.saveReview(storedReview());

		const updated = await applyFindingOps(
			{ sessionStore: store },
			CHANGESET_ID,
			{ kind: "edit", findingId: "finding-0", body: "reworded" },
		);

		expect(updated.findingEdits["finding-0"]).toEqual({ body: "reworded" });
		expect(await store.loadReview(CHANGESET_ID)).toEqual(updated);
	});

	it("marks a comment deleted, then restore clears it", async () => {
		const store = new FakeSessionStore();
		await store.saveReview(storedReview());

		const deleted = await applyFindingOps(
			{ sessionStore: store },
			CHANGESET_ID,
			{ kind: "delete", findingId: "finding-0" },
		);
		expect(deleted.findingEdits["finding-0"]).toEqual({ deleted: true });

		const restored = await applyFindingOps(
			{ sessionStore: store },
			CHANGESET_ID,
			{ kind: "restore", findingId: "finding-0" },
		);
		expect(restored.findingEdits["finding-0"]).toEqual({ deleted: false });
	});

	it("keeps an edited body across a later delete", async () => {
		const store = new FakeSessionStore();
		await store.saveReview(storedReview());
		await applyFindingOps({ sessionStore: store }, CHANGESET_ID, {
			kind: "edit",
			findingId: "finding-0",
			body: "reworded",
		});

		const deleted = await applyFindingOps(
			{ sessionStore: store },
			CHANGESET_ID,
			{ kind: "delete", findingId: "finding-0" },
		);

		expect(deleted.findingEdits["finding-0"]).toEqual({
			body: "reworded",
			deleted: true,
		});
	});

	it("rejects an id belonging to no finding in the pass", async () => {
		const store = new FakeSessionStore();
		await store.saveReview(storedReview());

		await expect(
			applyFindingOps({ sessionStore: store }, CHANGESET_ID, {
				kind: "edit",
				findingId: "finding-7",
				body: "x",
			}),
		).rejects.toMatchObject({ reason: "comment-not-found" });
	});

	it("rejects a changeset with no saved pass at all", async () => {
		const store = new FakeSessionStore();

		await expect(
			applyFindingOps({ sessionStore: store }, CHANGESET_ID, {
				kind: "delete",
				findingId: "finding-0",
			}),
		).rejects.toMatchObject({ reason: "no-review" });
	});

	it("edits the finding a stored id names, not the one at that position", async () => {
		const store = new FakeSessionStore();
		const stored = storedReview();
		const carried = { ...stored.pass.findings[0], body: "the carried one" };
		await store.saveReview({
			...stored,
			pass: { ...stored.pass, findings: [stored.pass.findings[0], carried] },
			findingIds: ["finding-3", "finding-0"],
		});

		const updated = await applyFindingOps(
			{ sessionStore: store },
			CHANGESET_ID,
			{ kind: "edit", findingId: "finding-0", body: "reworded" },
		);

		expect(updated.findingEdits).toEqual({ "finding-0": { body: "reworded" } });
	});

	it("rejects a position that a pass carrying its own ids never named", async () => {
		const store = new FakeSessionStore();
		const stored = storedReview();
		await store.saveReview({ ...stored, findingIds: ["finding-3"] });

		await expect(
			applyFindingOps({ sessionStore: store }, CHANGESET_ID, {
				kind: "delete",
				findingId: "finding-0",
			}),
		).rejects.toMatchObject({ reason: "comment-not-found" });
	});
});
