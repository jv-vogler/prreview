import { z } from "zod";

/**
 * Every non-2xx `/api` response (ARCHITECTURE §2): the one onError middleware
 * maps AppError → status + this body. `reason` is machine-readable and part
 * of the wire contract; clients switch on it, never on message text.
 */
export const errorDtoSchema = z.object({
	reason: z.string(),
	message: z.string(),
});

export type ErrorDto = z.infer<typeof errorDtoSchema>;
