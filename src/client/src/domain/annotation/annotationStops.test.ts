import type { FileDiffDto } from "@dto/ChangesetDto";
import { describe, expect, it } from "vitest";
import type { Explanation, Finding } from "./Annotation";
import { annotationStops, nextAnnotationStop } from "./annotationStops";

function file(id: string, hunkNewLines: readonly number[][]): FileDiffDto {
	return {
		id,
		path: `${id}.ts`,
		status: "modified",
		additions: 1,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: hunkNewLines.map((newLines, index) => ({
			id: `${id}h${index + 1}`,
			header: "@@",
			oldStart: 1,
			oldLines: newLines.length,
			newStart: newLines[0] ?? 1,
			newLines: newLines.length,
			lines: newLines.map((newLine) => ({
				type: "add" as const,
				content: "x",
				newLine,
			})),
		})),
	};
}

/**
 * A finding, because findings are what the margin renders and therefore what
 * `]` and `[` land on. This fixture used to build explanations, which matched
 * the filter the code had and not the balloons a reader sees.
 */
function note(fileId: string, endLine: number, id = `${fileId}-${endLine}`) {
	const finding: Finding = {
		id,
		species: "finding",
		anchor: {
			fileId,
			path: `${fileId}.ts`,
			side: "new",
			startLine: endLine,
			endLine,
			placement: "in-diff",
		},
		anchorStatus: "anchored",
		body: "body",
		title: null,
		touchedByDelta: false,
		createdAt: "2026-08-17T10:00:00.000Z",
		roundId: "r1",
		category: null,
		severity: null,
		proof: null,
		confidence: null,
		curation: null,
		groundingVerified: null,
		marks: [],
		citations: [],
		reproTest: null,
	};
	return finding;
}

/** narration lives on the Understanding tab and is never in the margin */
function explanation(fileId: string, endLine: number): Explanation {
	return {
		id: `x-${fileId}-${endLine}`,
		species: "explanation",
		kind: "intent",
		anchor: {
			fileId,
			path: `${fileId}.ts`,
			side: "new",
			startLine: endLine,
			endLine,
			placement: "in-diff",
		},
		anchorStatus: "anchored",
		body: "body",
		title: null,
		touchedByDelta: false,
		createdAt: "2026-08-17T10:00:00.000Z",
		roundId: "r1",
	};
}

const FILES = [
	file("f1", [
		[1, 2, 3],
		[20, 21],
	]),
	file("f2", [[5, 6]]),
];

describe("annotationStops", () => {
	it("lists one stop per hunk that carries notes, in reading order", () => {
		const stops = annotationStops(
			[note("f2", 6), note("f1", 21), note("f1", 2), note("f1", 3)],
			FILES,
		);

		expect(stops).toEqual([
			{ fileIndex: 0, hunkIndex: 0, noteCount: 2 },
			{ fileIndex: 0, hunkIndex: 1, noteCount: 1 },
			{ fileIndex: 1, hunkIndex: 0, noteCount: 1 },
		]);
	});

	it("sends a note anchored outside every hunk to the file's first hunk", () => {
		const fileLevel = note("f1", 0);
		fileLevel.anchor.placement = "file-level";

		expect(annotationStops([fileLevel], FILES)).toEqual([
			{ fileIndex: 0, hunkIndex: 0, noteCount: 1 },
		]);
	});

	/**
	 * The regression this filter shipped with: it selected explanations, which
	 * `placeAnnotations` never places, so every stop the keys could reach was a
	 * balloon that does not exist and every balloon that does was skipped.
	 */
	it("skips explanations, which never appear in the margin", () => {
		expect(annotationStops([explanation("f1", 2)], FILES)).toEqual([]);
		expect(
			annotationStops([explanation("f1", 2), note("f1", 3)], FILES),
		).toEqual([{ fileIndex: 0, hunkIndex: 0, noteCount: 1 }]);
	});

	it("ignores a note whose file is not on screen", () => {
		expect(annotationStops([note("gone", 3)], FILES)).toEqual([]);
	});

	it("walks forward and back without wrapping", () => {
		const stops = annotationStops([note("f1", 2), note("f2", 6)], FILES);

		expect(
			nextAnnotationStop(stops, { fileIndex: 0, hunkIndex: 0 }, "next"),
		).toMatchObject({ fileIndex: 1, hunkIndex: 0 });
		expect(
			nextAnnotationStop(stops, { fileIndex: 1, hunkIndex: 0 }, "next"),
		).toBeNull();
		expect(
			nextAnnotationStop(stops, { fileIndex: 1, hunkIndex: 0 }, "previous"),
		).toMatchObject({ fileIndex: 0, hunkIndex: 0 });
		expect(
			nextAnnotationStop(stops, { fileIndex: 0, hunkIndex: 0 }, "previous"),
		).toBeNull();
	});

	it("has nowhere to go with no notes at all", () => {
		expect(
			nextAnnotationStop([], { fileIndex: 0, hunkIndex: 0 }, "next"),
		).toBeNull();
	});
});
