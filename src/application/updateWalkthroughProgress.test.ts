import { describe, expect, it } from "vitest";
import { buildTestContainer } from "../../test/helpers/buildTestContainer";
import { EMPTY_READ_LOG } from "../../test/helpers/FakeEngine";
import { AnalysisError } from "../domain/errors/AnalysisError";
import { ValidationError } from "../domain/errors/ValidationError";
import type { ComprehensionOut } from "./analysis/schemas";

const OLD_OID = "1".repeat(40);
const NEW_OID = "2".repeat(40);

const DIFF = `diff --git a/a.ts b/a.ts
index ${OLD_OID}..${NEW_OID} 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
diff --git a/b.ts b/b.ts
index 3333333333333333333333333333333333333333..4444444444444444444444444444444444444444 100644
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,2 @@
 const x = 1;
-const y = 2;
+const y = 3;
`;

function comprehension(stepHunkIds: string[][]): ComprehensionOut {
	return {
		intentMap: {
			summary: "two constants change",
			clusters: [],
			suggestedEntryPoint: "a.ts",
		},
		walkthrough: {
			steps: stepHunkIds.map((hunkIds, index) => ({
				title: `step ${index}`,
				narration: "read this",
				focus: [{ path: index === 0 ? "a.ts" : "b.ts", hunkIds }],
			})),
		},
		explanations: [],
		risk: { hunkRisks: [] },
	};
}

/**
 * Opens a worktree review over the two-file diff and, when given a step plan,
 * stores an analysis whose steps focus the round's real hunkIds.
 */
async function reviewWithWalkthrough(
	stepsFrom?: (hunkIds: string[]) => string[][],
) {
	const setup = buildTestContainer({
		github: null,
		git: { refs: { HEAD: "a".repeat(40) }, worktreeDiff: DIFF },
	});
	const review = await setup.container.openReview({ target: "working" });
	const hunkIds = review.files.map((file) => file.hunks[0].id);
	if (stepsFrom !== undefined) {
		await setup.store.saveRoundAnalysis(
			review.manifest.changesetId,
			review.roundId,
			{
				comprehension: comprehension(stepsFrom(hunkIds)),
				readLog: EMPTY_READ_LOG,
				runId: "run-1",
				engineSessionId: "session-A",
			},
		);
	}
	return { setup, review, hunkIds };
}

describe("updateWalkthroughProgress", () => {
	it("marks the entered step's hunks viewed and answers with the fresh coverage", async () => {
		const { setup, review, hunkIds } = await reviewWithWalkthrough((ids) => [
			[ids[0]],
			[ids[1]],
		]);

		const updated = await setup.container.updateWalkthroughProgress({
			changesetId: review.manifest.changesetId,
			roundId: review.roundId,
			files: review.files,
			coverage: review.coverage,
			position: 0,
			completed: false,
		});

		expect(updated.progress).toEqual({ position: 0, completed: false });
		expect(updated.coverage).toEqual({ [hunkIds[0]]: "viewed" });
		// one of the round's two hunks is now seen
		expect(updated.summary.total).toBe(50);
		expect(
			(await setup.store.loadSessionManifest(review.manifest.changesetId))
				?.walkthroughProgress,
		).toEqual({ position: 0, completed: false });
		expect(
			await setup.store.loadWalkthroughProgress(review.manifest.changesetId),
		).toEqual({ position: 0, completed: false });
	});

	it("addresses steps by position, so a later step marks its own hunks", async () => {
		const { setup, review, hunkIds } = await reviewWithWalkthrough((ids) => [
			[ids[0]],
			[ids[1]],
		]);

		const updated = await setup.container.updateWalkthroughProgress({
			changesetId: review.manifest.changesetId,
			roundId: review.roundId,
			files: review.files,
			coverage: review.coverage,
			position: 1,
			completed: true,
		});

		expect(updated.coverage).toEqual({ [hunkIds[1]]: "viewed" });
		expect(updated.progress).toEqual({ position: 1, completed: true });
	});

	it("never downgrades a hunk the reader already reviewed", async () => {
		const { setup, review, hunkIds } = await reviewWithWalkthrough((ids) => [
			[ids[0]],
		]);
		const reviewed = await setup.container.updateCoverage({
			changesetId: review.manifest.changesetId,
			files: review.files,
			coverage: review.coverage,
			updates: [{ hunkId: hunkIds[0], state: "reviewed" }],
		});

		const updated = await setup.container.updateWalkthroughProgress({
			changesetId: review.manifest.changesetId,
			roundId: review.roundId,
			files: review.files,
			coverage: reviewed.coverage,
			position: 0,
			completed: true,
		});

		expect(updated.coverage[hunkIds[0]]).toBe("reviewed");
	});

	it("is idempotent when the same step is entered twice", async () => {
		const { setup, review } = await reviewWithWalkthrough((ids) => [ids]);
		const request = {
			changesetId: review.manifest.changesetId,
			roundId: review.roundId,
			files: review.files,
			coverage: review.coverage,
			position: 0,
			completed: false,
		};

		const first = await setup.container.updateWalkthroughProgress(request);
		const second = await setup.container.updateWalkthroughProgress({
			...request,
			coverage: first.coverage,
		});

		expect(second.coverage).toEqual(first.coverage);
		expect(second.summary).toEqual(first.summary);
	});

	it("ignores a hunkId the current round does not contain", async () => {
		const { setup, review } = await reviewWithWalkthrough(() => [["F9h9"]]);

		const updated = await setup.container.updateWalkthroughProgress({
			changesetId: review.manifest.changesetId,
			roundId: review.roundId,
			files: review.files,
			coverage: review.coverage,
			position: 0,
			completed: false,
		});

		expect(updated.coverage).toEqual({});
		expect(updated.summary.total).toBe(0);
	});

	it("refuses with AnalysisError('not-produced') before any analysis has run", async () => {
		const { setup, review } = await reviewWithWalkthrough();

		await expect(
			setup.container.updateWalkthroughProgress({
				changesetId: review.manifest.changesetId,
				roundId: review.roundId,
				files: review.files,
				coverage: review.coverage,
				position: 0,
				completed: false,
			}),
		).rejects.toThrow(AnalysisError);
	});

	it("refuses a step that does not exist", async () => {
		const { setup, review } = await reviewWithWalkthrough(() => [[]]);

		await expect(
			setup.container.updateWalkthroughProgress({
				changesetId: review.manifest.changesetId,
				roundId: review.roundId,
				files: review.files,
				coverage: review.coverage,
				position: 7,
				completed: false,
			}),
		).rejects.toThrow(ValidationError);
	});
});
