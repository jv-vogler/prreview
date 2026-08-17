import type { StoredAnnotation } from "../../domain/annotation/Annotation";
import type { AnnotationDto } from "./dto/AnnotationDto";

/**
 * The stored annotation minus its anchor snapshot. The snapshot exists so the
 * server can find the lines again after an edit (§6); sending the client
 * hashes and copies of code it already renders would be waste, and would invite
 * it to re-derive placement the server already decided (§9).
 */
export function toAnnotationDto(annotation: StoredAnnotation): AnnotationDto {
	const { snapshot: _snapshot, ...anchor } = annotation.anchor;
	return { ...annotation, anchor };
}
