// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Finding } from "../../domain/annotation/Annotation";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

/**
 * The card is where everything the pass computed either reaches a person or
 * does not. Four of the fields asserted here were computed correctly and
 * dropped on the way to the store, and the card showed generic copy in their
 * place — so these are the tests that go red if any of them stops arriving.
 */

function finding(overrides: Partial<Finding> = {}): Finding {
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
		touchedByDelta: false,
		createdAt: "2026-08-19T10:00:00.000Z",
		roundId: "r1",
		category: "correctness",
		severity: "should-fix",
		proof: { mode: "traced", how: "read both call sites", stale: false },
		confidence: "high",
		curation: null,
		groundingVerified: true,
		marks: [],
		citations: [],
		reproTest: null,
		...overrides,
	};
}

function renderCard(value: Finding) {
	return render(
		<MemoryRouter>
			<FindingCard
				finding={value}
				handle="F1"
				selected={false}
				onSelect={vi.fn()}
			/>
		</MemoryRouter>,
	);
}

describe("FindingCard", () => {
	/**
	 * The link addressed the file by **path** while the diff addresses it by
	 * `file.id`, so following a comment's location resolved nothing and landed at
	 * the top of the diff.
	 */
	it("links into the diff by file id, carrying the finding", () => {
		renderCard(finding());

		const link = screen.getByRole("link", { name: "src/greeting.ts:3" });
		expect(link.getAttribute("href")).toBe("/diff?file=F1&finding=a1");
	});

	it("states which citation was not read, rather than a generic warning", () => {
		renderCard(
			finding({
				groundingVerified: false,
				marks: [{ kind: "ungrounded-citation", path: "src/callers.ts" }],
			}),
		);

		expect(
			screen.getByText(/Cites src\/callers\.ts, which the agent did not read/),
		).toBeTruthy();
		// and not both sentences about the same fact
		expect(
			screen.queryByText("Not all cited files were read — treat as a lead"),
		).toBeNull();
	});

	it("says the path was inferred when the proof only reached so far", () => {
		renderCard(finding({ marks: [{ kind: "inferred-path" }] }));

		expect(screen.getByText(/inferred rather than traced/)).toBeTruthy();
	});

	/**
	 * A reword recomputes grounding and can lose the stamp without any single
	 * citation to blame, so the generic line is still the honest fallback.
	 */
	it("falls back to the generic warning when the stamp is gone with no mark", () => {
		renderCard(finding({ groundingVerified: false, marks: [] }));

		expect(
			screen.getByText("Not all cited files were read — treat as a lead"),
		).toBeTruthy();
	});

	it("shows what the finding cites besides its anchor", () => {
		renderCard(
			finding({
				citations: [
					{
						path: "src/callers.ts",
						startLine: 9,
						endLine: 12,
						note: "the caller that passes true",
					},
				],
			}),
		);

		expect(screen.getByText("src/callers.ts:9-12")).toBeTruthy();
		expect(screen.getByText(/the caller that passes true/)).toBeTruthy();
	});

	/** collapsed: 800 characters of test beside a 900-character body would swamp it */
	it("offers the repro test without opening it", () => {
		renderCard(finding({ reproTest: "expect(greet('hi!', true)).toBe('x');" }));

		const disclosure = screen.getByText("A test that would fail today");
		expect(disclosure.closest("details")?.hasAttribute("open")).toBe(false);
		expect(screen.getByText(/expect\(greet/)).toBeTruthy();
	});

	it("says nothing about a repro test that does not exist", () => {
		renderCard(finding());

		expect(screen.queryByText("A test that would fail today")).toBeNull();
	});
});
