import { describe, expect, it } from "vitest";
import type { Anchor, AnchorStatus } from "../anchor/Anchor";
import { captureSnapshot } from "../anchor/captureSnapshot";
import type { ReanchorResult } from "../anchor/reanchor";
import type { StoredAnnotation } from "./Annotation";
import {
	type DeltaHunkSets,
	type ReanchoredAnnotation,
	triageAnnotations,
} from "./triageAnnotations";

const FILE_LINES = ["const one = 1;", "const two = 2;", "const three = 3;"];

function makeAnchor(startLine: number, endLine: number): Anchor {
	return {
		fileId: "f_a1b2c3d4e5f6",
		path: "src/numbers.ts",
		side: "new",
		startLine,
		endLine,
		placement: "in-diff",
		snapshot: captureSnapshot(FILE_LINES, startLine, endLine, "oid-1"),
	};
}

function makeExplanation(
	id: string,
	overrides?: Partial<StoredAnnotation>,
): StoredAnnotation {
	return {
		id,
		species: "explanation",
		anchor: makeAnchor(1, 2),
		anchorStatus: "anchored",
		body: "explains the numbers",
		provenance: {
			roundId: "r1",
			stage: "comprehension",
			engineSessionId: "sess-1",
		},
		createdAt: "2026-08-16T00:00:00.000Z",
		...overrides,
	};
}

function makeResult(
	status: AnchorStatus,
	touchedByDelta: boolean,
): ReanchorResult {
	return { anchor: makeAnchor(2, 3), status, touchedByDelta };
}

function makeDelta(overrides?: Partial<DeltaHunkSets>): DeltaHunkSets {
	return {
		unchanged: new Set(["h-kept"]),
		changed: new Set(["h-edited"]),
		removed: new Set(["h-gone"]),
		...overrides,
	};
}

describe("triageAnnotations", () => {
	it("carries an anchored explanation with an untouched target silently", () => {
		const annotation = makeExplanation("01A");
		const result = makeResult("anchored", false);
		const triage = triageAnnotations(
			[{ annotation, reanchor: result, targetHunkIds: ["h-kept"] }],
			makeDelta(),
		);
		expect(triage.retired).toEqual([]);
		expect(triage.carried).toHaveLength(1);
		expect(triage.carried[0].anchor).toEqual(result.anchor);
		expect(triage.carried[0].anchorStatus).toBe("anchored");
		expect(triage.carried[0].touchedByDelta).toBeUndefined();
	});

	it("clears a stale touchedByDelta flag on a clean carry", () => {
		const annotation = makeExplanation("01B", { touchedByDelta: true });
		const triage = triageAnnotations(
			[
				{
					annotation,
					reanchor: makeResult("moved", false),
					targetHunkIds: ["h-kept"],
				},
			],
			makeDelta(),
		);
		expect(triage.carried[0].anchorStatus).toBe("moved");
		expect(triage.carried[0].touchedByDelta).toBeUndefined();
	});

	it("marks a fuzzy landing touchedByDelta", () => {
		const triage = triageAnnotations(
			[
				{
					annotation: makeExplanation("01C"),
					reanchor: makeResult("fuzzy", true),
					targetHunkIds: ["h-kept"],
				},
			],
			makeDelta(),
		);
		expect(triage.carried[0].anchorStatus).toBe("fuzzy");
		expect(triage.carried[0].touchedByDelta).toBe(true);
	});

	it("marks an anchored target inside the delta touchedByDelta", () => {
		const triage = triageAnnotations(
			[
				{
					annotation: makeExplanation("01D"),
					reanchor: makeResult("anchored", false),
					targetHunkIds: ["h-kept", "h-edited"],
				},
			],
			makeDelta(),
		);
		expect(triage.carried[0].anchorStatus).toBe("anchored");
		expect(triage.carried[0].touchedByDelta).toBe(true);
	});

	it("retires an orphaned explanation automatically", () => {
		const annotation = makeExplanation("01E");
		const triage = triageAnnotations(
			[
				{
					annotation,
					reanchor: {
						anchor: annotation.anchor,
						status: "orphaned",
						touchedByDelta: false,
					},
					targetHunkIds: [],
				},
			],
			makeDelta(),
		);
		expect(triage.carried).toEqual([]);
		expect(triage.retired).toEqual(["01E"]);
	});

	it("triages a mixed batch into both buckets", () => {
		const reanchored: ReanchoredAnnotation[] = [
			{
				annotation: makeExplanation("01F"),
				reanchor: makeResult("anchored", false),
				targetHunkIds: ["h-kept"],
			},
			{
				annotation: makeExplanation("01G"),
				reanchor: makeResult("orphaned", false),
				targetHunkIds: [],
			},
		];
		const triage = triageAnnotations(reanchored, makeDelta());
		expect(triage.carried.map((annotation) => annotation.id)).toEqual(["01F"]);
		expect(triage.retired).toEqual(["01G"]);
	});

	it("triages a finding the same way, since its anchor is the point of it", () => {
		const finding = {
			...makeExplanation("a1"),
			species: "finding" as const,
		};
		const triaged = triageAnnotations(
			[
				{
					annotation: finding,
					reanchor: {
						status: "moved",
						anchor: finding.anchor,
						touchedByDelta: false,
					},
					targetHunkIds: [],
				},
			],
			makeDelta(),
		);
		expect(triaged.carried).toHaveLength(1);
		expect(triaged.carried[0]?.species).toBe("finding");
		expect(triaged.retired).toEqual([]);
	});
});
