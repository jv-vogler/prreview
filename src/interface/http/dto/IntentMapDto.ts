import { z } from "zod";

const intentMapClusterMemberDtoSchema = z.object({
	path: z.string(),
	/** empty means the whole file — the agent named it without hunk precision */
	hunkIds: z.array(z.string()),
});

const intentMapClusterDtoSchema = z.object({
	name: z.string(),
	kind: z.enum([
		"core",
		"refactor",
		"tests",
		"config",
		"docs",
		"generated",
		"chore",
	]),
	description: z.string(),
	members: z.array(intentMapClusterMemberDtoSchema),
});

/**
 * `GET /api/intent-map` (ARCHITECTURE §8): what the change is trying to do,
 * grouped into clusters, plus where to start reading. 404 with reason
 * `not-produced` until stage A has run. Risk scores from the same stage stay
 * off the wire in M2 (ALT-008).
 */
export const intentMapDtoSchema = z.object({
	summary: z.string(),
	clusters: z.array(intentMapClusterDtoSchema),
	suggestedEntryPoint: z.string(),
});

export type IntentMapDto = z.infer<typeof intentMapDtoSchema>;
