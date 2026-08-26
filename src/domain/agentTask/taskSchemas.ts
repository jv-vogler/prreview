import { reviewOutputSchema } from "../pass/ReviewPass";
import { reworkResultSchema } from "./reworkPrompt";

export const taskSchemas = {
	review: reviewOutputSchema,
	rework: reworkResultSchema,
} as const;
