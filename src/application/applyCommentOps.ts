import type { ChangesetId } from "../domain/changeset/ChangesetId";
import { ReviewCommentError } from "../domain/errors/ReviewCommentError";
import { findingIndexForCommentId } from "../domain/review/reviewCommentId";
import type {
	CommentEdit,
	SessionStore,
	StoredReview,
} from "./ports/SessionStore";

/**
 * The reader's three moves on one comment (REQ-006): overwrite its body,
 * remove it from view, or bring a removed one back. `restore` exists
 * because `delete` is meant to be undoable — nothing here is destructive
 * until a new pass overwrites the whole artifact.
 */
export type CommentOp =
	| { kind: "edit"; commentId: string; body: string }
	| { kind: "delete"; commentId: string }
	| { kind: "restore"; commentId: string };

export interface ApplyCommentOpsDeps {
	sessionStore: SessionStore;
}

/**
 * The single write path for curating one comment (TASK-046): every mutation
 * — edit, delete, restore — goes through here, so every one of them is
 * validated the same way and lands in the store the same way. Never touches
 * `pass.findings` itself; curation is a layer on top, kept in
 * `commentEdits`, so the engine's own answer stays intact underneath it.
 */
export async function applyCommentOps(
	deps: ApplyCommentOpsDeps,
	changesetId: ChangesetId,
	op: CommentOp,
): Promise<StoredReview> {
	const stored = await deps.sessionStore.loadReview(changesetId);
	if (stored === null) {
		throw new ReviewCommentError(
			"no-review",
			"No review pass exists for this changeset yet.",
		);
	}
	const index = findingIndexForCommentId(op.commentId);
	if (index === null || stored.pass.findings[index] === undefined) {
		throw new ReviewCommentError(
			"comment-not-found",
			`Comment ${op.commentId} does not exist in the stored pass.`,
		);
	}

	const updated: StoredReview = {
		...stored,
		commentEdits: {
			...stored.commentEdits,
			[op.commentId]: nextEdit(stored.commentEdits[op.commentId], op),
		},
	};
	await deps.sessionStore.saveReview(updated);
	return updated;
}

function nextEdit(
	current: CommentEdit | undefined,
	op: CommentOp,
): CommentEdit {
	switch (op.kind) {
		case "edit":
			return { ...current, body: op.body };
		case "delete":
			return { ...current, deleted: true };
		case "restore":
			return { ...current, deleted: false };
	}
}
