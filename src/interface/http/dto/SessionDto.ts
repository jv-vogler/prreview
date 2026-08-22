import { z } from "zod";

/** `GET /api/session`'s answer: a liveness check plus what the client may show (TASK-039). */
export const sessionDtoSchema = z.object({
	status: z.literal("ok"),
	serverTime: z.string(),
	featureFlags: z.object({
		/** REQ-009: with no claude on PATH, AI surfaces are absent, not disabled */
		aiAvailable: z.boolean(),
		/** REQ-007: with no publish-capable GitHub backend, publish is absent too */
		githubAvailable: z.boolean(),
	}),
});

export type SessionDto = z.infer<typeof sessionDtoSchema>;
