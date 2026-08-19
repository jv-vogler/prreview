import { describe, expect, it } from "vitest";
import { InMemorySessionStore } from "../../test/helpers/InMemorySessionStore";
import type { StoredAnnotation } from "../domain/annotation/Annotation";
import type { AnnotationOp } from "../domain/annotation/annotationOps";
import type { RoundReadLog } from "../domain/review/groundingGate";
import { applyAnnotationOps } from "./applyAnnotationOps";

/**
 * The hostile file. Every test here is an attempt to get a dishonest edit
 * through the one write path — because the point of routing chat and PATCH
 * through the same function is that these cannot be attempted twice.
 */

const CHANGESET = "worktree";
const WORKSPACE = "/tmp/prreview-worktree/repo";
const AT = "2026-08-17T12:00:00.000Z";

const READ_LOG: RoundReadLog = {
	reads: [{ path: `${WORKSPACE}/src/retry.ts` }],
	searchHits: [],
};

function finding(overrides: Partial<StoredAnnotation> = {}): StoredAnnotation {
	return {
		id: "01ABC",
		species: "finding",
		anchor: {
			fileId: "f1",
			path: "src/retry.ts",
			side: "new",
			startLine: 10,
			endLine: 10,
			placement: "in-diff",
			snapshot: {
				blobOid: "oid",
				targetLines: ["retry(attempt);"],
				lineHash: "h",
				contextBefore: [],
				contextAfter: [],
			},
		},
		anchorStatus: "anchored",
		body: "Retries hammer a failing endpoint: the backoff is computed but never awaited.",
		provenance: { roundId: "r1", stage: "review", engineSessionId: "s1" },
		createdAt: AT,
		severity: "blocker",
		category: "correctness",
		groundingVerified: true,
		proof: { mode: "traced", how: "read retry and its caller" },
		...overrides,
	};
}

async function apply(
	ops: AnnotationOp[],
	seeded: StoredAnnotation[] = [finding()],
	log: RoundReadLog = READ_LOG,
) {
	const store = new InMemorySessionStore();
	await store.saveAnnotations(CHANGESET, seeded);
	const published: unknown[] = [];
	const result = await applyAnnotationOps(
		{ store, publish: (event) => published.push(event) },
		{
			changesetId: CHANGESET,
			ops,
			readLog: log,
			workspaceDir: WORKSPACE,
			at: AT,
		},
	);
	const after = await store.loadAnnotations(CHANGESET);
	return { result, after, published };
}

describe("applyAnnotationOps", () => {
	it("rewords a comment and keeps what it originally said", async () => {
		const { result, after } = await apply([
			{
				op: "reword",
				handle: "F1",
				body: "Retries hammer a failing endpoint; the backoff is never awaited.",
			},
		]);

		expect(result.rejected).toEqual([]);
		expect(after[0]?.body).toContain("never awaited");
		expect(after[0]?.originalBody).toContain("computed but never awaited");
		expect(after[0]?.editTrail).toHaveLength(1);
	});

	/** gate 5: the first rewrite is the one that captures the agent's own words */
	it("never overwrites originalBody on a second rewrite", async () => {
		const { after } = await apply([
			{ op: "reword", handle: "F1", body: "First rewrite of the claim." },
			{ op: "reword", handle: "F1", body: "Second rewrite of the claim." },
		]);
		expect(after[0]?.originalBody).toContain("computed but never awaited");
		expect(after[0]?.body).toBe("Second rewrite of the claim.");
		expect(after[0]?.editTrail).toHaveLength(2);
	});

	/** gate 2: "make it nicer" is exactly where the prose tells come back */
	it("rejects a rewrite that fails the form rules", async () => {
		const { result, after } = await apply([
			{
				op: "reword",
				handle: "F1",
				body: "It's worth noting that this might potentially be an issue.",
			},
		]);
		expect(result.applied).toEqual([]);
		expect(result.rejected[0]?.reason).toContain("form rules");
		expect(after[0]?.body).toContain("computed but never awaited");
	});

	/** gate 4: the proof was about the sentence that is now gone */
	it("marks the proof stale and demotes a blocker on a rewrite", async () => {
		const { after } = await apply([
			{ op: "reword", handle: "F1", body: "The backoff is never awaited." },
		]);
		expect(after[0]?.proof?.stale).toBe(true);
		expect(after[0]?.severity).toBe("should-fix");
	});

	/** gate 3: an edit must not launder an unverified claim through a stamp */
	it("recomputes grounding rather than carrying the old stamp", async () => {
		const { after } = await apply(
			[{ op: "reword", handle: "F1", body: "The backoff is never awaited." }],
			[finding({ groundingVerified: true })],
			// the round read nothing, so the citation is no longer grounded
			{ reads: [], searchHits: [] },
		);
		expect(after[0]?.groundingVerified).toBe(false);
	});

	/** gate 1: reword has no field for an anchor, so it cannot move a claim */
	it("leaves the anchor untouched through a rewrite", async () => {
		const { after } = await apply([
			{ op: "reword", handle: "F1", body: "The backoff is never awaited." },
		]);
		expect(after[0]?.anchor.startLine).toBe(10);
		expect(after[0]?.anchor.path).toBe("src/retry.ts");
	});

	/** drop is dismissal, never deletion */
	it("drops by dismissing, so the comment survives and can come back", async () => {
		const { after } = await apply([
			{ op: "drop", handle: "F1", reason: "intentional" },
		]);
		expect(after).toHaveLength(1);
		expect(after[0]?.curation?.state).toBe("dismissed");
		expect(after[0]?.curation?.dismissReason).toBe("intentional");
	});

	/**
	 * The bug an undo is supposed to undo: a lingering dismissal record keeps
	 * suppressing the finding in the next review pass.
	 */
	it("restores by clearing the dismissal, not by relabelling it", async () => {
		const { after } = await apply(
			[{ op: "restore", handle: "F1" }],
			[
				finding({
					curation: { state: "dismissed", dismissReason: "no", updatedAt: AT },
				}),
			],
		);
		expect(after[0]?.curation).toBeUndefined();
	});

	/** unknown handles are reported, never best-guess matched */
	it("rejects a handle that names nothing, and says so", async () => {
		const { result, after } = await apply([
			{ op: "drop", handle: "F9" },
			{ op: "drop", handle: "not-a-handle" },
		]);
		expect(result.applied).toEqual([]);
		expect(result.rejected).toHaveLength(2);
		expect(result.rejected[0]?.reason).toContain("F9");
		expect(after[0]?.curation).toBeUndefined();
	});

	it("applies the ops that resolve even when others do not", async () => {
		const { result, after } = await apply([
			{ op: "drop", handle: "F1" },
			{ op: "drop", handle: "F7" },
		]);
		expect(result.applied).toHaveLength(1);
		expect(result.rejected).toHaveLength(1);
		expect(after[0]?.curation?.state).toBe("dismissed");
	});

	/**
	 * There is no `create`, and the ops that would move or multiply a claim
	 * without re-checking it are refused rather than half-implemented.
	 */
	it("refuses to move or multiply a claim", async () => {
		const { result, after } = await apply([
			{ op: "reanchor", handle: "F1", startLine: 99, endLine: 99 },
			{ op: "split", handle: "F1", bodies: ["one", "two"] },
		]);
		expect(result.applied).toEqual([]);
		expect(result.rejected).toHaveLength(2);
		expect(after).toHaveLength(1);
		expect(after[0]?.anchor.startLine).toBe(10);
	});

	it("retiers without touching the claim or its proof", async () => {
		const { after } = await apply([
			{ op: "retier", handle: "F1", severity: "consider" },
		]);
		expect(after[0]?.severity).toBe("consider");
		expect(after[0]?.proof?.stale).toBeUndefined();
		expect(after[0]?.groundingVerified).toBe(true);
	});

	it("announces every applied change so open clients patch their caches", async () => {
		const { published } = await apply([{ op: "drop", handle: "F1" }]);
		expect(published).toHaveLength(1);
		expect(published[0]).toMatchObject({ type: "annotation.upserted" });
	});

	it("writes nothing when every op was rejected", async () => {
		const { published, result } = await apply([{ op: "drop", handle: "F4" }]);
		expect(result.applied).toEqual([]);
		expect(published).toEqual([]);
	});
});
