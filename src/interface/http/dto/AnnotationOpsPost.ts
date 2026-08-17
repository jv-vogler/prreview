import { z } from "zod";

/**
 * `POST /api/annotations/ops` — the closed vocabulary of edits, on the wire.
 *
 * Ops are single-target and name their subject by its display handle (`F1`), so
 * the user, the chat lane, and the server all mean the same comment. An unknown
 * handle comes back in `rejected` rather than being matched approximately.
 *
 * There is deliberately **no `create`**: a comment must originate in a review
 * run, behind a proof line and a grounding check. A wire shape that could
 * conjure one would be a bypass around every gate.
 */
const annotationOpSchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("reword"), handle: z.string(), body: z.string() }),
	z.object({
		op: z.literal("retier"),
		handle: z.string(),
		severity: z.enum(["blocker", "should-fix", "consider", "nitpick"]),
	}),
	z.object({
		op: z.literal("drop"),
		handle: z.string(),
		reason: z.string().max(200).optional(),
	}),
	z.object({ op: z.literal("restore"), handle: z.string() }),
	z.object({
		op: z.literal("reclassify"),
		handle: z.string(),
		category: z.string(),
	}),
	z.object({
		op: z.literal("split"),
		handle: z.string(),
		bodies: z.array(z.string()),
	}),
	z.object({
		op: z.literal("reanchor"),
		handle: z.string(),
		startLine: z.int().min(0),
		endLine: z.int().min(0),
	}),
	z.object({ op: z.literal("defend"), handle: z.string() }),
]);

export const annotationOpsPostSchema = z.object({
	ops: z.array(annotationOpSchema).min(1).max(50),
});

/** what happened, including what did not — rejections are never swallowed */
export const annotationOpsResultSchema = z.object({
	applied: z.array(z.string()),
	rejected: z.array(z.object({ handle: z.string(), reason: z.string() })),
});

export type AnnotationOpsPost = z.infer<typeof annotationOpsPostSchema>;
export type AnnotationOpsResult = z.infer<typeof annotationOpsResultSchema>;
