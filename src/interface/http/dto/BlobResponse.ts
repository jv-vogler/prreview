import { z } from "zod";

/** One side of a file's contents, shaped for the diff renderer's context reads. */
export const blobResponseSchema = z.object({
	name: z.string(),
	contents: z.string(),
});

export type BlobResponse = z.infer<typeof blobResponseSchema>;
