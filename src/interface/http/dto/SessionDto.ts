import { z } from "zod";

export const sessionDtoSchema = z.object({
	status: z.literal("ok"),
	serverTime: z.string(),
	featureFlags: z.object({
		aiAvailable: z.boolean(),

		githubAvailable: z.boolean(),
	}),
});

export type SessionDto = z.infer<typeof sessionDtoSchema>;
