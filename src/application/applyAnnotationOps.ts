import type { StoredAnnotation } from "../domain/annotation/Annotation";
import type {
	AnnotationOp,
	OpRejection,
} from "../domain/annotation/annotationOps";
import { partitionOps } from "../domain/annotation/annotationOps";
import { checkForm } from "../domain/review/formGate";
import {
	checkGrounding,
	type RoundReadLog,
} from "../domain/review/groundingGate";
import type { PublishEvent } from "./ports/EventPublisher";
import type { SessionStore } from "./ports/SessionStore";

/**
 * The **one** write path for a suggested comment.
 *
 * Both `PATCH /api/annotations/:id` and a chat turn's ops come through here, so
 * every gate below is unskippable by construction rather than by discipline. A
 * second write path is how one of these quietly stops applying.
 *
 * Six gates keep an edit honest:
 *
 * 1. **Anchors and citations are unreachable from `reword`.** The op has no
 *    field for them, so a reword cannot move a comment onto different code and
 *    then keep asserting the old claim.
 * 2. **Every reworded body re-runs the full form gate.** A rewrite is where the
 *    pasteable budget and the prose tells come back, precisely because the
 *    model is being asked to make it "nicer".
 * 3. **`groundingVerified` is recomputed, never carried.** Inheriting the old
 *    stamp would let an edit launder an unverified claim through a verified
 *    one.
 * 4. **A reworded claim marks its proof stale and demotes a blocker.** The
 *    proof was about the sentence that was there; changing the sentence does
 *    not re-establish it, and the most damaging thing a stale proof can do is
 *    keep a blocker's confidence.
 * 5. **`originalBody` is write-once, with an append-only edit trail.** What the
 *    agent actually said stays recoverable no matter how many rewrites follow.
 * 6. **Unknown handles are rejected out loud** (see `partitionOps`).
 */

export interface ApplyAnnotationOpsDeps {
	store: SessionStore;
	publish: PublishEvent;
}

export interface ApplyAnnotationOpsInput {
	changesetId: string;
	ops: readonly AnnotationOp[];
	/** the round's read log, for recomputing grounding */
	readLog: RoundReadLog;
	workspaceDir: string;
	at: string;
}

export interface ApplyAnnotationOpsResult {
	applied: string[];
	rejected: OpRejection[];
}

const DEMOTED_FROM_BLOCKER = "should-fix";

export async function applyAnnotationOps(
	deps: ApplyAnnotationOpsDeps,
	input: ApplyAnnotationOpsInput,
): Promise<ApplyAnnotationOpsResult> {
	const stored = await deps.store.loadAnnotations(input.changesetId);
	// handles are assigned over the findings a reader can actually see, in the
	// order they see them — the same ordering the comments tab renders
	const ordered = stored.filter(
		(annotation) =>
			annotation.species === "finding" ||
			annotation.species === "related-finding",
	);

	const { resolved, rejected } = partitionOps(input.ops, ordered);
	const applied: string[] = [];
	const byId = new Map(stored.map((annotation) => [annotation.id, annotation]));

	for (const { op, id } of resolved) {
		const current = byId.get(id);
		if (current === undefined) {
			rejected.push({ op, reason: "that comment no longer exists" });
			continue;
		}
		const next = applyOne(op, current, input, rejected);
		if (next !== null) {
			byId.set(id, next);
			applied.push(id);
		}
	}

	if (applied.length > 0) {
		const updated = stored.map(
			(annotation) => byId.get(annotation.id) ?? annotation,
		);
		await deps.store.saveAnnotations(input.changesetId, updated);
		for (const id of applied) {
			const annotation = byId.get(id);
			if (annotation !== undefined) {
				deps.publish({ type: "annotation.upserted", annotation });
			}
		}
	}

	return { applied, rejected };
}

function applyOne(
	op: AnnotationOp,
	current: StoredAnnotation,
	input: ApplyAnnotationOpsInput,
	rejected: OpRejection[],
): StoredAnnotation | null {
	switch (op.op) {
		case "reword":
			return reword(op.body, current, input, rejected);

		case "retier":
			// curation, not a new claim: the sentence is unchanged, so grounding
			// and proof stay exactly as they were
			return {
				...current,
				severity: op.severity,
				curation: touch(current, input.at),
			};

		case "reclassify":
			return {
				...current,
				category: op.category,
				curation: touch(current, input.at),
			};

		case "drop":
			// never deletion: `drop` maps onto the dismissed curation state, so it
			// is recoverable and so the next review pass can suppress it
			return {
				...current,
				curation: {
					state: "dismissed",
					...(op.reason === undefined ? {} : { dismissReason: op.reason }),
					updatedAt: input.at,
				},
			};

		case "restore":
			// clearing the entry entirely, not setting it back to `proposed`: a
			// lingering dismissal record keeps suppressing the finding in the next
			// pass, which is exactly the bug an undo is supposed to undo
			return { ...current, curation: undefined };

		case "defend":
			// a request for justification changes nothing; the answer is prose in
			// the chat thread, and pretending it edited the finding would be a lie
			rejected.push({
				op,
				reason: "defend is answered in chat and changes nothing on the comment",
			});
			return null;

		case "reanchor":
		case "split":
			// Both move a claim onto code it was not made about, or manufacture
			// claims that never went through a review run's gates. Neither is
			// reachable until there is a way to re-verify the result.
			rejected.push({
				op,
				reason: `${op.op} is not supported: it would move or multiply a claim without re-checking it`,
			});
			return null;
	}
}

/**
 * Gate 2, 3, 4, and 5 in one place, because a reword is the only op that
 * changes what the comment *claims*.
 */
function reword(
	body: string,
	current: StoredAnnotation,
	input: ApplyAnnotationOpsInput,
	rejected: OpRejection[],
): StoredAnnotation | null {
	const violations = checkForm({ body });
	if (violations.length > 0) {
		rejected.push({
			op: { op: "reword", handle: "", body },
			reason: `the rewrite fails the form rules: ${violations
				.map((violation) => violation.rule)
				.join(", ")}`,
		});
		return null;
	}

	// recomputed against the same citations, never carried over from before
	const grounding = checkGrounding({
		citations: [
			{
				path: current.anchor.path,
				startLine: current.anchor.startLine,
				endLine: current.anchor.endLine,
			},
			...(current.citations ?? []),
		],
		log: input.readLog,
		workspaceDir: input.workspaceDir,
	});

	return {
		...current,
		body,
		// write-once: the first rewrite captures what the agent actually said
		originalBody: current.originalBody ?? current.body,
		editTrail: [
			...(current.editTrail ?? []),
			{ at: input.at, by: "chat" as const, previousBody: current.body },
		],
		groundingVerified: grounding.grounded,
		// the proof was established about the sentence that is now gone
		...(current.proof === undefined
			? {}
			: { proof: { ...current.proof, stale: true } }),
		// ...and a stale proof must not keep a blocker's authority
		...(current.severity === "blocker"
			? { severity: DEMOTED_FROM_BLOCKER }
			: {}),
		curation: {
			state: "edited" as const,
			updatedAt: input.at,
			...(current.curation?.dismissReason === undefined
				? {}
				: { dismissReason: current.curation.dismissReason }),
		},
	};
}

function touch(
	current: StoredAnnotation,
	at: string,
): StoredAnnotation["curation"] {
	return {
		state: current.curation?.state ?? "edited",
		...(current.curation?.dismissReason === undefined
			? {}
			: { dismissReason: current.curation.dismissReason }),
		updatedAt: at,
	};
}
