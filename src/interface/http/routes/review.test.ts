import { describe, expect, it } from "vitest";
import { createAnalysisApp } from "../../../../test/helpers/createAnalysisApp";
import type { RoundReview } from "../../../application/review/RoundReview";
import { reviewSummaryDtoSchema } from "../dto/ReviewSummaryDto";

/**
 * What the findings pass threw away, served.
 *
 * Every number here was computed correctly and dropped before this endpoint
 * existed, which is the failure this codebase keeps repeating: a reader saw six
 * comments and had no way to know ten candidates went in.
 */

function record(overrides: Partial<RoundReview> = {}): RoundReview {
	return {
		discarded: [],
		skippedAnchors: 0,
		readLog: { reads: [], searchHits: [] },
		runId: "run-1",
		producedAt: "2026-08-19T10:00:00.000Z",
		...overrides,
	};
}

async function serve(review?: RoundReview) {
	const app = await createAnalysisApp();
	if (review !== undefined) {
		await app.container.store.saveRoundReview(
			app.review.manifest.changesetId,
			app.review.roundId,
			review,
		);
		app.state.applyReview(null);
	}
	return { app, response: await app.app.request("/api/review") };
}

describe("GET /api/review", () => {
	/** "not produced yet" is a state the tab renders as its invitation */
	it("404s not-produced before any review has run", async () => {
		const { response } = await serve();

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ reason: "not-produced" });
	});

	it("groups the discards by reason and counts each group", async () => {
		const { response } = await serve(
			record({
				discarded: [
					{
						title: "Too unsure to raise",
						species: "finding",
						severity: "consider",
						lenses: ["design"],
						reason: {
							kind: "below-confidence-floor",
							confidence: 62,
							floor: 80,
						},
					},
					{
						title: "Also too unsure",
						species: "finding",
						severity: "consider",
						lenses: ["design"],
						reason: {
							kind: "below-confidence-floor",
							confidence: 71,
							floor: 80,
						},
					},
					{
						title: "Reads like a chatbot",
						species: "finding",
						severity: "should-fix",
						lenses: ["correctness"],
						reason: { kind: "form", rules: ["prose-tell"] },
					},
				],
				skippedAnchors: 1,
			}),
		);

		expect(response.status).toBe(200);
		const body = reviewSummaryDtoSchema.parse(await response.json());
		expect(body.discardedTotal).toBe(3);
		expect(body.skippedAnchors).toBe(1);
		expect(body.discarded).toEqual([
			{
				reason: "form",
				count: 1,
				examples: ["Reads like a chatbot"],
			},
			{
				reason: "below-confidence-floor",
				count: 2,
				examples: ["Too unsure to raise", "Also too unsure"],
			},
		]);
	});

	/** the hardest cut first: a dropped blocker is what a reader most wants to see */
	it("puts the ungrounded blockers at the top", async () => {
		const { response } = await serve(
			record({
				discarded: [
					{
						title: "Too unsure",
						species: "finding",
						severity: "consider",
						lenses: ["design"],
						reason: {
							kind: "below-confidence-floor",
							confidence: 62,
							floor: 80,
						},
					},
					{
						title: "A blocker about code nobody opened",
						species: "finding",
						severity: "blocker",
						lenses: ["security"],
						reason: {
							kind: "ungrounded-blocker",
							path: "src/callers.ts",
							why: "never-opened",
						},
					},
				],
			}),
		);

		const body = reviewSummaryDtoSchema.parse(await response.json());
		expect(body.discarded.map((group) => group.reason)).toEqual([
			"ungrounded-blocker",
			"below-confidence-floor",
		]);
	});

	/**
	 * A body that failed the form gate is exactly the noise the gate exists to
	 * remove; putting it back on the wire would undo the pass.
	 */
	it("carries titles but never the bodies the gates rejected", async () => {
		const { response } = await serve(
			record({
				discarded: Array.from({ length: 9 }, (_, index) => ({
					title: `Candidate ${index}`,
					species: "finding" as const,
					severity: "consider",
					lenses: ["design"],
					reason: { kind: "form" as const, rules: ["prose-too-long"] },
				})),
			}),
		);

		const body = reviewSummaryDtoSchema.parse(await response.json());
		expect(body.discardedTotal).toBe(9);
		// counted in full, listed in part
		expect(body.discarded[0]?.count).toBe(9);
		expect(body.discarded[0]?.examples).toHaveLength(5);
		expect(JSON.stringify(body)).not.toContain("prose-too-long");
	});

	it("serves an empty summary when a review kept everything", async () => {
		const { response } = await serve(record());

		const body = reviewSummaryDtoSchema.parse(await response.json());
		expect(body).toEqual({
			discardedTotal: 0,
			discarded: [],
			skippedAnchors: 0,
		});
	});
});
