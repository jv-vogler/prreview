import { z } from "zod";

/**
 * Where a note is glued (ARCHITECTURE §6), as the client sees it. The stored
 * anchor's `snapshot` — normalized target lines, their hash, context lines —
 * is deliberately absent: it exists so the SERVER can re-anchor after an edit,
 * and the client only ever places what the server already resolved (§9).
 */
export const anchorDtoSchema = z.object({
	fileId: z.string(),
	path: z.string(),
	side: z.enum(["old", "new"]),
	/** 0/0 means file-level */
	startLine: z.int().min(0),
	endLine: z.int().min(0),
	placement: z.enum(["in-diff", "in-file", "file-level"]),
});

export type AnchorDto = z.infer<typeof anchorDtoSchema>;

/** the outcome of the last re-anchoring pass (§6) */
export const anchorStatusDtoSchema = z.enum([
	"anchored",
	"moved",
	"fuzzy",
	"orphaned",
]);

export type AnchorStatusDto = z.infer<typeof anchorStatusDtoSchema>;
