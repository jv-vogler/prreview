import { z } from "zod";

/**
 * `GET /api/blob?ref=&path=` query: `ref` is a commit sha or the WORKING /
 * INDEX sentinels; `path` must sit in the changeset's file allowlist —
 * containment is the route's job (SEC-002), shape is validated here.
 */
export const blobRequestSchema = z.object({
	ref: z.string().min(1),
	path: z.string().min(1),
});

export type BlobRequest = z.infer<typeof blobRequestSchema>;
