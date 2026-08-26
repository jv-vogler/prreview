import { z } from "zod";
import { storedReviewPassSchema } from "../../domain/pass/ReviewPass";

const findingEditSchema = z.object({
	body: z.string().optional(),
	deleted: z.boolean().optional(),
});

function fromLegacyNames(stored: unknown): unknown {
	if (typeof stored !== "object" || stored === null) {
		return stored;
	}
	const record = { ...(stored as Record<string, unknown>) };
	renameKey(record, "commentEdits", "findingEdits");
	if (typeof record.published === "object" && record.published !== null) {
		const published = { ...(record.published as Record<string, unknown>) };
		renameKey(published, "commentIds", "findingIds");
		record.published = published;
	}
	return record;
}

function renameKey(
	record: Record<string, unknown>,
	from: string,
	to: string,
): void {
	if (record[to] === undefined && record[from] !== undefined) {
		record[to] = record[from];
	}
	delete record[from];
}

const publishedRecordSchema = z.object({
	reviewId: z.number(),
	htmlUrl: z.string(),
	publishedAt: z.string(),
	findingIds: z.array(z.string()),
});

const checkpointSchema = z.object({
	baseSha: z.string(),
	headSha: z.string().nullable(),
	files: z.array(
		z.object({
			path: z.string(),
			oldOid: z.string().nullable(),
			newOid: z.string().nullable(),
		}),
	),
});

export const storedReviewSchema = z.preprocess(
	fromLegacyNames,
	z.object({
		changesetId: z.string(),
		createdAt: z.string(),

		headSha: z.string().nullable().default(null),

		pass: storedReviewPassSchema,
		residue: z.array(z.string()),

		findingEdits: z.record(z.string(), findingEditSchema).default({}),

		findingIds: z.array(z.string()).optional(),
		nextFindingId: z.int().min(0).optional(),

		carriedFindingIds: z.array(z.string()).optional(),

		checkpoint: checkpointSchema.optional(),

		published: publishedRecordSchema.nullable().default(null),
	}),
);
