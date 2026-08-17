import type { AnnotationDto } from "@dto/AnnotationDto";
import { describe, expect, it } from "vitest";
import { annotationIsExplanation } from "./Annotation";
import { toAnnotation } from "./toAnnotation";

function dto(overrides: Partial<AnnotationDto> = {}): AnnotationDto {
	return {
		id: "01J000000000000000000000A",
		species: "explanation",
		anchor: {
			fileId: "f1",
			path: "src/server.ts",
			side: "new",
			startLine: 10,
			endLine: 14,
			placement: "in-diff",
		},
		anchorStatus: "anchored",
		body: "The port now comes from the config object.",
		provenance: {
			roundId: "r1",
			stage: "comprehension",
			engineSessionId: "s1",
		},
		createdAt: "2026-08-17T10:00:00.000Z",
		...overrides,
	};
}

describe("toAnnotation", () => {
	it("narrows an explanation and reads its kind from the category", () => {
		const annotation = toAnnotation(dto({ category: "mechanism" }));
		expect(annotationIsExplanation(annotation)).toBe(true);
		expect(annotation).toMatchObject({
			species: "explanation",
			kind: "mechanism",
			roundId: "r1",
			touchedByDelta: false,
			title: null,
		});
	});

	it("keeps a note whose category the client does not know, without a kind", () => {
		const annotation = toAnnotation(dto({ category: "some-future-kind" }));
		expect(annotation).toMatchObject({ species: "explanation", kind: null });
	});

	it("carries the anchor, its status, and the delta mark through unchanged", () => {
		const annotation = toAnnotation(
			dto({ anchorStatus: "fuzzy", touchedByDelta: true, title: "Config" }),
		);
		expect(annotation.anchorStatus).toBe("fuzzy");
		expect(annotation.touchedByDelta).toBe(true);
		expect(annotation.title).toBe("Config");
		expect(annotation.anchor.placement).toBe("in-diff");
	});

	it("narrows the two finding species M3 will send", () => {
		const finding = toAnnotation(
			dto({ species: "finding", category: "correctness", confidence: "high" }),
		);
		expect(finding).toMatchObject({
			species: "finding",
			category: "correctness",
			confidence: "high",
		});

		const related = toAnnotation(dto({ species: "related-finding" }));
		expect(related).toMatchObject({
			species: "related-finding",
			category: null,
			confidence: null,
		});
	});
});
