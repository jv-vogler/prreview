import type { DiffLineAnnotation } from "@pierre/diffs";
import { fixtureFiles } from "./fixture";

export type AnnotationSpecies = "note" | "warning" | "suggestion";

export interface AnnotationMetadata {
	id: string;
	species: AnnotationSpecies;
	title: string;
	body: string;
}

export type SpikeAnnotation = DiffLineAnnotation<AnnotationMetadata>;

const SPECIES_CYCLE: AnnotationSpecies[] = ["note", "warning", "suggestion"];
const ANNOTATION_COUNT = 30;

const FILLER =
	"This sentence pads the card so heights vary between annotations, which is what the spike must prove the renderer can lay out. ";

/** Variable heights: card body length grows with the annotation index. */
function annotationBody(index: number): string {
	return FILLER.repeat(1 + (index % 5));
}

/**
 * One annotation per file for the first 30 fixture files, anchored on the
 * first added line of a rotating hunk so every annotation sits on a real
 * additions-side line.
 */
export function buildAnnotationsByFile(): Map<string, SpikeAnnotation[]> {
	const byFile = new Map<string, SpikeAnnotation[]>();
	for (let index = 0; index < ANNOTATION_COUNT; index++) {
		const file = fixtureFiles[index];
		const edit = file.edits[index % file.edits.length];
		const species = SPECIES_CYCLE[index % SPECIES_CYCLE.length];
		const annotation: SpikeAnnotation = {
			side: "additions",
			lineNumber: edit.newStart,
			metadata: {
				id: `ann-${index}`,
				species,
				title: `${species} #${index} on ${file.name}`,
				body: annotationBody(index),
			},
		};
		const existing = byFile.get(file.name) ?? [];
		existing.push(annotation);
		byFile.set(file.name, existing);
	}
	return byFile;
}

export const annotationCount = ANNOTATION_COUNT;
