import { describe, expect, it } from "vitest";
import type { Annotation, Explanation } from "./Annotation";
import { placeAnnotations } from "./placeAnnotations";

function explanation(overrides: Partial<Explanation> = {}): Explanation {
	return {
		id: "a1",
		species: "explanation",
		kind: "mechanism",
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
		const placed = placeAnnotations([explanation()]);

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
			explanation({ id: "a1" }),
			explanation({
				id: "a2",
				anchor: { ...explanation().anchor, fileId: "f2", path: "src/main.ts" },
			}),
			explanation({ id: "a3" }),
		]);

		expect(placed.get("f1")?.map((entry) => entry.card)).toHaveLength(2);
		expect(placed.get("f2")?.map((entry) => entry.card)).toHaveLength(1);
	});

	it("collapses a file's orphaned notes into one tray at the top", () => {
		const placed = placeAnnotations([
			explanation({ id: "a1", anchorStatus: "orphaned" }),
			explanation({ id: "a2", anchorStatus: "orphaned" }),
			explanation({ id: "a3" }),
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
			explanation({
				anchor: { ...explanation().anchor, side: "old", endLine: 9 },
			}),
		]);

		expect(placed.get("f1")?.[0]).toMatchObject({
			side: "deletions",
			lineNumber: 9,
		});
	});

	it("places nothing for a species this milestone does not render", () => {
		const { kind: _explanationKind, ...base } = explanation();
		const finding: Annotation = {
			...base,
			species: "finding",
			category: null,
			confidence: "high",
		};

		expect(placeAnnotations([finding]).size).toBe(0);
	});

	it("returns an empty map for no annotations", () => {
		expect(placeAnnotations([]).size).toBe(0);
	});
});
