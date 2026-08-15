import { z } from "zod";

/**
 * One side of a file's contents, shaped for Pierre's `loadDiffFiles` loader
 * (contract captured by TASK-012, spikes/pierre/VERDICT.md): the client
 * wrapper maps two of these — old side from `prevName ?? name` at the base
 * ref, new side from `name` at the head ref — into the renderer's
 * `{oldFile, newFile}` pair.
 */
export const blobResponseSchema = z.object({
	name: z.string(),
	contents: z.string(),
});

export type BlobResponse = z.infer<typeof blobResponseSchema>;
