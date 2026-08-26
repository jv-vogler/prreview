import { z } from "zod";

export const blobRequestSchema = z.object({
	ref: z.string().min(1),
	path: z.string().min(1),
});

export type BlobRequest = z.infer<typeof blobRequestSchema>;
