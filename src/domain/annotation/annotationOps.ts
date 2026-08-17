/**
 * The closed vocabulary of things that may be done to a suggested comment.
 *
 * Closed, and single-target. "Make them all more concise and drop 1 and 3" is
 * one turn producing N+2 ops, each naming exactly what it touches — which means
 * every one is inspectable, reversible, and gated individually. A free-form
 * "edit these" would be none of those.
 *
 * **There is deliberately no `create`.** A finding must originate in a review
 * run, with a proof line and a grounding check behind it. A text box that
 * conjures one is a bypass around every gate this pipeline has, and it would be
 * the first thing anyone reached for.
 */

export type AnnotationOp =
	| { op: "reword"; handle: string; body: string }
	| { op: "retier"; handle: string; severity: string }
	| { op: "drop"; handle: string; reason?: string }
	| { op: "restore"; handle: string }
	| { op: "reclassify"; handle: string; category: string }
	| { op: "split"; handle: string; bodies: string[] }
	| { op: "reanchor"; handle: string; startLine: number; endLine: number }
	| { op: "defend"; handle: string };

export const OP_NAMES = [
	"reword",
	"retier",
	"drop",
	"restore",
	"reclassify",
	"split",
	"reanchor",
	"defend",
] as const;

/**
 * Stable short handles in display order, so a person and the model mean the
 * same finding.
 *
 * Without these, referring to a comment means quoting its text back, and the
 * model matching that quote approximately is precisely the failure mode where
 * the wrong comment gets dropped.
 */
export function handleFor(index: number): string {
	return `F${index + 1}`;
}

export function resolveHandle(
	handle: string,
	ordered: readonly { id: string }[],
): string | null {
	const matched = /^F(\d+)$/.exec(handle.trim().toUpperCase());
	if (matched?.[1] === undefined) {
		return null;
	}
	const index = Number(matched[1]) - 1;
	return ordered[index]?.id ?? null;
}

export interface OpRejection {
	op: AnnotationOp;
	reason: string;
}

/**
 * Splits ops into the ones that name a real finding and the ones that do not.
 *
 * Unknown handles are **rejected, never best-guess matched**, and the rejection
 * is reported rather than swallowed. Silently doing nothing about `F9` when
 * there are four findings leaves the user believing something happened; quietly
 * applying it to the nearest one is worse.
 */
export function partitionOps(
	ops: readonly AnnotationOp[],
	ordered: readonly { id: string }[],
): { resolved: { op: AnnotationOp; id: string }[]; rejected: OpRejection[] } {
	const resolved: { op: AnnotationOp; id: string }[] = [];
	const rejected: OpRejection[] = [];

	for (const op of ops) {
		const id = resolveHandle(op.handle, ordered);
		if (id === null) {
			rejected.push({
				op,
				reason: `no suggested comment is called ${op.handle}`,
			});
			continue;
		}
		resolved.push({ op, id });
	}
	return { resolved, rejected };
}
