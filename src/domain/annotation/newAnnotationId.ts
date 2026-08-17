import { ulid } from "ulid";

/**
 * Annotation ids are ulids (ARCHITECTURE §11): sortable ids give stable
 * annotation ordering without a parallel sort key. The one place the
 * dependency is touched.
 */
export function newAnnotationId(): string {
	return ulid();
}
