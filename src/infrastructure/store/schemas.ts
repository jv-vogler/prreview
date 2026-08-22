import { z } from "zod";
import { reviewPassSchema } from "../../application/review/reviewSchema";

/** what a stored `review.json` must look like to be trusted back off disk */
export const storedReviewSchema = z.object({
	changesetId: z.string(),
	createdAt: z.string(),
	pass: reviewPassSchema,
	residue: z.array(z.string()),
});
