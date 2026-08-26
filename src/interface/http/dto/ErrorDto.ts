import { z } from "zod";

export const errorDtoSchema = z.object({
	reason: z.string(),
	message: z.string(),
});

export type ErrorDto = z.infer<typeof errorDtoSchema>;
