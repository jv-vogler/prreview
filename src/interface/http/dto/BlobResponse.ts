import { z } from "zod";

export const blobResponseSchema = z.object({
	name: z.string(),
	contents: z.string(),
});

export type BlobResponse = z.infer<typeof blobResponseSchema>;
