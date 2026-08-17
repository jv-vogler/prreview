import { describe, expect, it } from "vitest";
import type { Annotation, Explanation, Finding } from "./Annotation";
import { placeAnnotations } from "./placeAnnotations";

/** the margin holds findings; narration lives on the Understanding tab */
function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		id: "a1",
		species: "finding",
		category: "correctness",
		severity: "should-fix",
		confidence: "high",
		proof: null,
		curation: null,
		groundingVerified: true,
		anchor: {
			fileId: "f1",
			path: "src/greeting.ts",
			side: "new",
			startLine: 3,
			endLine: 4,
			placement: "in-diff",
		},
		anchorStatus: "anchored",
		body: "body",
		title: null,
		touchedByDelta: false,
		createdAt: "2026-08-17T10:00:00.000Z",
		roundId: "r1",
		...overrides,
	};
}

describe("placeAnnotations", () => {
	it("hangs a note under the last line of its range, on the new side", () => {
		const placed = placeAnnotations([finding()]);

		expect(placed.get("f1")).toEqual([
			{
				side: "additions",
				lineNumber: 4,
				card: { kind: "note", note: expect.objectContaining({ id: "a1" }) },
			},
		]);
	});

	it("keeps each file's notes together", () => {
		const placed = placeAnnotations([
			finding({ id: "a1" }),
			finding({
				id: "a2",
				anchor: { ...finding().anchor, fileId: "f2", path: "src/main.ts" },
			}),
			finding({ id: "a3" }),
		]);

		expect(placed.get("f1")?.map((entry) => entry.card)).toHaveLength(2);
		expect(placed.get("f2")?.map((entry) => entry.card)).toHaveLength(1);
	});

	it("collapses a file's orphaned notes into one tray at the top", () => {
		const placed = placeAnnotations([
			finding({ id: "a1", anchorStatus: "orphaned" }),
			finding({ id: "a2", anchorStatus: "orphaned" }),
			finding({ id: "a3" }),
		]);

		const entries = placed.get("f1") ?? [];
		expect(entries).toHaveLength(2);
		const tray = entries.find((entry) => entry.card.kind === "unanchored");
		expect(tray?.lineNumber).toBe(0);
		expect(
			tray?.card.kind === "unanchored" ? tray.card.notes.map((n) => n.id) : [],
		).toEqual(["a1", "a2"]);
	});

	it("puts a deletion-side note on the deletions side", () => {
		const placed = placeAnnotations([
			finding({
				anchor: { ...finding().anchor, side: "old", endLine: 9 },
			}),
		]);

		expect(placed.get("f1")?.[0]).toMatchObject({
			side: "deletions",
			lineNumber: 9,
		});
	});

	it("places nothing for an explanation: narration is not margin material", () => {
		const explanation: Explanation = {
			id: "e1",
			species: "explanation",
			kind: "mechanism",
			anchor: finding().anchor,
			anchorStatus: "anchored",
			body: "what this does",
			title: null,
			touchedByDelta: false,
			createdAt: "2026-08-17T10:00:00.000Z",
			roundId: "r1",
		};
		expect(placeAnnotations([explanation])).toEqual(new Map());
	});

	it("returns an empty map for no annotations", () => {
		expect(placeAnnotations([]).size).toBe(0);
	});
});
