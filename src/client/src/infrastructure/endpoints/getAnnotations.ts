import type { AnnotationDto } from "@dto/AnnotationDto";
import { annotationDtoSchema } from "@dto/AnnotationDto";
import { z } from "zod";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

const responseSchema = z.array(annotationDtoSchema);

/**
 * Every annotation of the current round. With no agent this is an empty list
 * rather than a failure (REQ-004) — the viewer floor simply has none.
 */
export async function getAnnotations(api: ApiClient): Promise<AnnotationDto[]> {
	const data = await api.get("/api/annotations");
	return parseLogged(responseSchema, data, "GET /api/annotations");
}
