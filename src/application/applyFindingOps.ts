import type { ChangesetId } from "../domain/changeset/ChangesetId";
import { FindingError } from "../domain/errors/FindingError";
import { findingIndexFor } from "../domain/finding/findingId";
import type { FindingEdit, StoredReview } from "../domain/pass/StoredReview";
import type { SessionStore } from "./ports/SessionStore";

export type FindingOp =
	| { kind: "edit"; findingId: string; body: string }
	| { kind: "delete"; findingId: string }
	| { kind: "restore"; findingId: string };

export interface ApplyFindingOpsDeps {
	sessionStore: SessionStore;
}

export async function applyFindingOps(
	deps: ApplyFindingOpsDeps,
	changesetId: ChangesetId,
	op: FindingOp,
): Promise<StoredReview> {
	const stored = await deps.sessionStore.loadReview(changesetId);
	if (stored === null) {
		throw new FindingError(
			"no-review",
			"No review pass exists for this changeset yet.",
		);
	}
	const index = findingIndexFor(stored, op.findingId);
	if (index === null || stored.pass.findings[index] === undefined) {
		throw new FindingError(
			"comment-not-found",
			`Finding ${op.findingId} does not exist in the stored pass.`,
		);
	}

	const updated: StoredReview = {
		...stored,
		findingEdits: {
			...stored.findingEdits,
			[op.findingId]: nextEdit(stored.findingEdits[op.findingId], op),
		},
	};
	await deps.sessionStore.saveReview(updated);
	return updated;
}

function nextEdit(
	current: FindingEdit | undefined,
	op: FindingOp,
): FindingEdit {
	switch (op.kind) {
		case "edit":
			return { ...current, body: op.body };
		case "delete":
			return { ...current, deleted: true };
		case "restore":
			return { ...current, deleted: false };
	}
}
