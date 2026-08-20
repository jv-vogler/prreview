// @vitest-environment jsdom
import type { AnnotationDto } from "@dto/AnnotationDto";
import type { ReviewSummaryDto } from "@dto/ReviewSummaryDto";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HttpError } from "../infrastructure/httpClients/HttpError";
import { AnalysisProvider } from "../view/analysis/AnalysisProvider";
import { FindingSelectionProvider } from "../view/findings/FindingSelectionProvider";
import {
	renderWithProviders,
	sessionDto,
} from "../view/testing/renderWithProviders";
import { CommentsPage } from "./CommentsPage";

afterEach(cleanup);

/** the designed 404: no review has run against this round */
const NOT_PRODUCED = new HttpError(404, "not-produced", "nothing yet");

function annotation(overrides: Partial<AnnotationDto> = {}): AnnotationDto {
	return {
		id: "a1",
		species: "finding",
		anchor: {
			fileId: "F1",
			path: "src/greeting.ts",
			side: "new",
			startLine: 3,
			endLine: 4,
			placement: "in-diff",
		},
		anchorStatus: "anchored",
		body: "Callers passing their own punctuation get it doubled.",
		title: "Excited greetings double an exclamation",
		provenance: { roundId: "r1", stage: "review", engineSessionId: "s1" },
		createdAt: "2026-08-19T10:00:00.000Z",
		category: "correctness",
		severity: "should-fix",
		...overrides,
	};
}

function summary(overrides: Partial<ReviewSummaryDto> = {}): ReviewSummaryDto {
	return {
		discardedTotal: 0,
		discarded: [],
		skippedAnchors: 0,
		...overrides,
	};
}

function renderPage(responses: Record<string, unknown>) {
	return renderWithProviders(
		<FindingSelectionProvider>
			<AnalysisProvider>
				<CommentsPage />
			</AnalysisProvider>
		</FindingSelectionProvider>,
		{
			initialPath: "/comments",
			responses: { "/api/session": sessionDto("claude"), ...responses },
		},
	);
}

/** past the suspense gate on the session, and past the annotations fetch */
async function settled(): Promise<void> {
	await waitFor(() => expect(screen.queryByText("loading")).toBeNull());
	await waitFor(() =>
		expect(screen.queryByText("Loading suggested comments…")).toBeNull(),
	);
}

/** past the suspense gate only — the page's own loading state is the subject */
async function mounted(): Promise<void> {
	await waitFor(() => expect(screen.queryByText("loading")).toBeNull());
}

describe("CommentsPage", () => {
	it("lists the comments a pass produced", async () => {
		renderPage({
			"/api/annotations": [annotation()],
			"/api/review": summary(),
		});
		await settled();

		expect(
			screen.getByText("Excited greetings double an exclamation"),
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Suggested comments" }),
		).toBeTruthy();
	});

	/**
	 * The invitation is what "no review has run" looks like. It used to render
	 * while the first fetch was still out too, so a reload during a review
	 * offered to start another one.
	 */
	it("does not offer to run a review while the comments are still loading", async () => {
		let release = (_value: AnnotationDto[]) => {};
		const pending = new Promise<AnnotationDto[]>((resolve) => {
			release = resolve;
		});
		renderPage({ "/api/annotations": pending, "/api/review": NOT_PRODUCED });
		await mounted();

		expect(
			screen.queryByRole("heading", {
				name: "Review this change for problems",
			}),
		).toBeNull();
		expect(screen.getByText("Loading suggested comments…")).toBeTruthy();

		await act(async () => {
			release([annotation()]);
			await pending;
		});
		await settled();
		expect(
			screen.getByText("Excited greetings double an exclamation"),
		).toBeTruthy();
	});

	it("invites a review, at a depth, when nothing has run", async () => {
		renderPage({ "/api/annotations": [], "/api/review": NOT_PRODUCED });
		await settled();

		expect(
			screen.getByRole("heading", { name: "Review this change for problems" }),
		).toBeTruthy();
		// three presets, each saying what it buys in readings rather than "thinking"
		expect(screen.getByText("Light")).toBeTruthy();
		expect(screen.getByText("Standard")).toBeTruthy();
		expect(screen.getByText("Thorough")).toBeTruthy();
		expect(screen.getByText(/2 readings/)).toBeTruthy();
	});

	it("sends the chosen preset, and only the preset", async () => {
		const { post } = renderPage({
			"/api/annotations": [],
			"/api/review": NOT_PRODUCED,
		});
		await settled();

		act(() => {
			(
				screen.getByText("Thorough").previousElementSibling as HTMLElement
			).click();
		});
		act(() => {
			screen.getByRole("button", { name: "Review this change" }).click();
		});

		// the mutation fires the request a microtask later
		await waitFor(() =>
			expect(post).toHaveBeenCalledWith("/api/analysis", {
				task: "review",
				depth: { preset: "thorough" },
			}),
		);
	});

	it("defaults to standard without being asked", async () => {
		const { post } = renderPage({
			"/api/annotations": [],
			"/api/review": NOT_PRODUCED,
		});
		await settled();

		act(() => {
			screen.getByRole("button", { name: "Review this change" }).click();
		});

		await waitFor(() =>
			expect(post).toHaveBeenCalledWith("/api/analysis", {
				task: "review",
				depth: { preset: "standard" },
			}),
		);
	});

	/**
	 * Ten candidates in and six comments out is a fact about the pass that a
	 * reader had no way of learning. Collapsed, because it is evidence rather
	 * than a second list to read.
	 */
	it("reports what did not make the cut, collapsed, with per-reason counts", async () => {
		renderPage({
			"/api/annotations": [annotation()],
			"/api/review": summary({
				discardedTotal: 3,
				discarded: [
					{
						reason: "ungrounded-blocker",
						count: 1,
						examples: ["A secret reaches the log"],
					},
					{
						reason: "below-confidence-floor",
						count: 2,
						examples: ["Might be slow", "Might race"],
					},
				],
				skippedAnchors: 1,
			}),
		});
		await settled();

		const section = document.querySelector("[data-discarded-summary]");
		expect(section?.tagName.toLowerCase()).toBe("details");
		expect(section?.hasAttribute("open")).toBe(false);
		expect(screen.getByText("3 candidates didn't make the cut")).toBeTruthy();
		expect(
			screen.getByText("Not grounded in code the agent read"),
		).toBeTruthy();
		expect(screen.getByText("Too unsure")).toBeTruthy();
		expect(screen.getByText("A secret reaches the log")).toBeTruthy();
		// the other loss, which used to be reported nowhere at all
		expect(screen.getByText("Could not be placed")).toBeTruthy();
	});

	it("says nothing about discards when a pass kept everything", async () => {
		renderPage({
			"/api/annotations": [annotation()],
			"/api/review": summary(),
		});
		await settled();

		expect(document.querySelector("[data-discarded-summary]")).toBeNull();
	});

	/**
	 * Species discipline on screen: a reviewer pasting comments onto someone's
	 * pull request must never hand them a complaint about code the change did
	 * not touch.
	 */
	it("keeps pre-existing problems in their own section", async () => {
		renderPage({
			"/api/annotations": [
				annotation(),
				annotation({
					id: "a2",
					species: "related-finding",
					title: "This helper never validated its input",
				}),
			],
			"/api/review": summary(),
		});
		await settled();

		expect(
			screen.getByRole("heading", { name: /Noticed nearby/ }),
		).toBeTruthy();
	});

	it("refreshes when the server says a pass landed", async () => {
		const { events, get } = renderPage({
			"/api/annotations": [annotation()],
			"/api/review": summary(),
		});
		await settled();
		const before = get.mock.calls.length;

		await act(async () => {
			events.emit({ type: "findings.updated", roundId: "r1" });
		});

		// the server publishes this event and nothing used to listen, so
		// `findingsAvailable` and the discard record never refreshed after a run
		await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before));
	});
});
