import { z } from "zod";
import { storedReviewPassSchema } from "../../domain/pass/ReviewPass";

const findingEditSchema = z.object({
	body: z.string().optional(),
	deleted: z.boolean().optional(),
});

/**
 * A finding used to be called a comment, on disk as well as in code. The
 * adapter is where that difference belongs: it renames the two legacy keys on
 * the way in so a review.json written under the old vocabulary keeps its
 * curation and its publish record instead of silently losing both.
 */
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

/** what a stored `review.json` must look like to be trusted back off disk */
export const storedReviewSchema = z.preprocess(
	fromLegacyNames,
	z.object({
		changesetId: z.string(),
		createdAt: z.string(),
		// defaulted so a review.json written before the field still loads;
		// null also means "worktree — no commit to name"
		headSha: z.string().nullable().default(null),
		// the pass's own length budgets are not applied here: they gate what the
		// engine may write, and re-applying them on read makes tightening one
		// retroactively corrupt every session already on disk
		pass: storedReviewPassSchema,
		residue: z.array(z.string()),
		// defaulted so a review.json written before TASK-046 still loads
		findingEdits: z.record(z.string(), findingEditSchema).default({}),
		// both absent on a pass written before ids became data: its findings are
		// named by position, which is exactly the ids the first pass minted
		findingIds: z.array(z.string()).optional(),
		nextFindingId: z.int().min(0).optional(),
		// absent on a pass whose findings were all looked at in the run that
		// wrote it, which is every pass written before delta re-reviews
		carriedFindingIds: z.array(z.string()).optional(),
		// absent on a pass written before checkpoints: a re-review over one of
		// those re-reads everything, exactly as it always did
		checkpoint: checkpointSchema.optional(),
		// defaulted so a review.json written before TASK-050 still loads
		published: publishedRecordSchema.nullable().default(null),
	}),
);
