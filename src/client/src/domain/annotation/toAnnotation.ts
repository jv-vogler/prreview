import type { AnnotationDto } from "@dto/AnnotationDto";
import type { Annotation, ExplanationKind } from "./Annotation";
import { EXPLANATION_KINDS } from "./Annotation";

/**
 * The wire shape into the app's shape: the DTO carries every field M3 and M4
 * will need as an optional, and this narrows it to the species union the view
 * switches on. Absent optionals become explicit `null`s so a component never
 * has to know which fields this milestone happens to send.
 */
export function toAnnotation(dto: AnnotationDto): Annotation {
	const base = {
		id: dto.id,
		anchor: dto.anchor,
		anchorStatus: dto.anchorStatus,
		body: dto.body,
		title: dto.title ?? null,
		touchedByDelta: dto.touchedByDelta ?? false,
		createdAt: dto.createdAt,
		roundId: dto.provenance.roundId,
	};
	if (dto.species === "explanation") {
		return { ...base, species: "explanation", kind: toExplanationKind(dto) };
	}
	return {
		...base,
		species: dto.species,
		category: dto.category ?? null,
		severity: dto.severity ?? null,
		proof:
			dto.proof === undefined
				? null
				: {
						mode: dto.proof.mode,
						how: dto.proof.how,
						stale: dto.proof.stale ?? false,
					},
		confidence: dto.confidence ?? null,
		curation:
			dto.curation === undefined
				? null
				: {
						state: dto.curation.state,
						dismissReason: dto.curation.dismissReason ?? null,
					},
		groundingVerified: dto.groundingVerified ?? null,
	};
}

function toExplanationKind(dto: AnnotationDto): ExplanationKind | null {
	const category = dto.category;
	if (category === undefined) {
		return null;
	}
	return EXPLANATION_KINDS.find((kind) => kind === category) ?? null;
}
