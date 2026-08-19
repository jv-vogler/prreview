import type { z } from "zod";
import { representativeReviewOutSchema } from "../review/reviewSchemas";
import { representativeTopicsOutSchema } from "./topicSchemas";
import { representativeUnderstandingOutSchema } from "./understandingSchemas";

/**
 * Every zod schema that is ever converted by `toJsonSchema` and handed to
 * `claude --json-schema`, in one registry.
 *
 * It exists so the checks that must hold for *all* of them — the Ajv
 * draft-07 gate (CON-014) and the 85KB argv budget (CON-005) — iterate a list
 * that cannot silently fall behind. Adding a task schema anywhere else without
 * registering it here means it ships ungated, so register it here first and
 * let the colocated tests cover it for free.
 */
export const TASK_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
	// per-round `maxTopics` varies, but the gates test the schema's shape, which
	// does not — so one representative instance covers every round
	understanding: representativeUnderstandingOutSchema,
	topics: representativeTopicsOutSchema,
	review: representativeReviewOutSchema,
};
