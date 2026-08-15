import { z } from "zod";

// The dto folder redeclares the IR's wire shape in zod rather than importing
// the domain types: it may import nothing but zod (CON-002), which is what
// makes it safe for the browser bundle to share these schemas at runtime.

export const changesetSourceDtoSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("pr"),
		repo: z.string(),
		number: z.number().int(),
	}),
	z.object({ kind: z.literal("branch"), branch: z.string(), base: z.string() }),
	z.object({ kind: z.literal("range"), from: z.string(), to: z.string() }),
	z.object({ kind: z.literal("worktree") }),
]);

export type ChangesetSourceDto = z.infer<typeof changesetSourceDtoSchema>;

export const changesetRefDtoSchema = z.object({
	source: changesetSourceDtoSchema,
	requestedAs: z.string().optional(),
	baseSha: z.string(),
	headSha: z.string().nullable(),
	worktreeFingerprint: z.string().optional(),
	resolvedAt: z.string(),
});

export type ChangesetRefDto = z.infer<typeof changesetRefDtoSchema>;

export const blobRefDtoSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("odb"), oid: z.string() }),
	z.object({ kind: z.literal("worktree"), path: z.string(), oid: z.string() }),
	z.object({ kind: z.literal("stored"), oid: z.string() }),
]);

export const diffLineDtoSchema = z.object({
	type: z.enum(["context", "add", "del"]),
	content: z.string(),
	oldLine: z.number().int().optional(),
	newLine: z.number().int().optional(),
	noEol: z.boolean().optional(),
});

export const hunkDtoSchema = z.object({
	id: z.string(),
	header: z.string(),
	oldStart: z.number().int(),
	oldLines: z.number().int(),
	newStart: z.number().int(),
	newLines: z.number().int(),
	lines: z.array(diffLineDtoSchema),
});

export const fileDiffDtoSchema = z.object({
	id: z.string(),
	path: z.string(),
	oldPath: z.string().optional(),
	status: z.enum([
		"added",
		"modified",
		"deleted",
		"renamed",
		"copied",
		"type-changed",
	]),
	additions: z.number().int(),
	deletions: z.number().int(),
	isBinary: z.boolean(),
	isGenerated: z.boolean(),
	language: z.string().optional(),
	oldBlob: blobRefDtoSchema.nullable(),
	newBlob: blobRefDtoSchema.nullable(),
	hunks: z.array(hunkDtoSchema),
});

export type FileDiffDto = z.infer<typeof fileDiffDtoSchema>;

/** `GET /api/changeset`: the current round's files, hunks, and ref (ARCHITECTURE §8). */
export const changesetDtoSchema = z.object({
	changesetId: z.string(),
	roundId: z.string(),
	ref: changesetRefDtoSchema,
	files: z.array(fileDiffDtoSchema),
});

export type ChangesetDto = z.infer<typeof changesetDtoSchema>;
