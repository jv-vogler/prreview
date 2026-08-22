import type { ChangesetId } from "../domain/changeset/ChangesetId";
import type { ChangesetSource } from "../domain/changeset/ChangesetSource";
import type { FileDiff } from "../domain/changeset/FileDiff";
import { PublishError } from "../domain/errors/PublishError";
import { ReviewCommentError } from "../domain/errors/ReviewCommentError";
import type { GithubService, ReviewComment } from "./ports/GithubService";
import type { SessionStore, StoredReview } from "./ports/SessionStore";
import type { EffectiveComment } from "./review/effectiveComments";
import { effectiveComments } from "./review/effectiveComments";

export interface PublishReviewDeps {
	/** null = no GitHub backend at all (REQ-009's treatment, mirrored for publish) */
	githubService: GithubService | null;
	sessionStore: SessionStore;
}

export type PublishExclusionReason = "pre-existing" | "unplaceable";

export interface PublishExclusion {
	id: string;
	reason: PublishExclusionReason;
}

/**
 * Publishes the current artifact as a pending GitHub review (GOAL-007,
 * REQ-007, TASK-050): only `review`-lane, placeable comments are sent —
 * `event` stays omitted all the way down to `GhCliGithubService` so the
 * review lands PENDING for the reader to submit themselves, never
 * submitted by prreview itself. The local artifact is never cleared
 * (TASK-053): only `published` changes, so a second pass — more edits, then
 * publish again — is always possible.
 */
export async function publishReview(
	deps: PublishReviewDeps,
	changesetId: ChangesetId,
	source: ChangesetSource,
	files: readonly FileDiff[],
): Promise<StoredReview> {
	if (deps.githubService === null) {
		throw new PublishError(
			"no-github",
			"No GitHub backend is available; there is nothing to publish to.",
		);
	}
	if (source.kind !== "pr") {
		throw new PublishError(
			"not-a-pull-request",
			"This changeset is not a pull request; there is nothing to publish a review to.",
		);
	}

	const stored = await deps.sessionStore.loadReview(changesetId);
	if (stored === null) {
		throw new ReviewCommentError(
			"no-review",
			"No review pass exists for this changeset yet.",
		);
	}

	const { included } = buildPublishPayload(effectiveComments(stored, files));
	if (included.length === 0) {
		throw new PublishError(
			"nothing-publishable",
			"Every comment in this pass was excluded; there is nothing to publish.",
		);
	}

	await discardStalePendingReview(deps.githubService, source.number, stored);

	const review = await deps.githubService.createPendingReview(source.number, {
		comments: included.map((comment) => comment.wire),
	});

	const updated: StoredReview = {
		...stored,
		published: {
			reviewId: review.id,
			htmlUrl: review.htmlUrl,
			publishedAt: new Date().toISOString(),
			commentIds: included.map((comment) => comment.id),
		},
	};
	await deps.sessionStore.saveReview(updated);
	return updated;
}

/**
 * GitHub allows at most one pending review per user per pull request
 * (docs/github-review-notes.md, TASK-014) — publishing again after further
 * edits must clear the previous attempt first. Best-effort: the tracked
 * review may already be gone — submitted or deleted by the reader on
 * GitHub directly — and that is never a reason to block a fresh publish.
 */
async function discardStalePendingReview(
	githubService: GithubService,
	pr: number,
	stored: StoredReview,
): Promise<void> {
	if (stored.published === null) {
		return;
	}
	try {
		await githubService.deletePendingReview(pr, stored.published.reviewId);
	} catch {
		// already gone — nothing to clean up
	}
}

/**
 * Splits the artifact's comments into what will actually be sent and what
 * is left behind, and why (TASK-050, REQ-010, REQ-011) — pure and exported
 * so both halves are directly testable, ahead of anything touching the
 * network. GitHub validates a review's `comments[]` atomically
 * (docs/github-review-notes.md, TASK-016): one unresolvable comment 422s
 * the whole batch and creates nothing, including the good ones — so nothing
 * unresolvable may ever reach `included`.
 */
export function buildPublishPayload(comments: readonly EffectiveComment[]): {
	included: { id: string; wire: ReviewComment }[];
	excluded: PublishExclusion[];
} {
	const included: { id: string; wire: ReviewComment }[] = [];
	const excluded: PublishExclusion[] = [];
	for (const comment of comments) {
		const classified = classify(comment);
		if (classified.kind === "included") {
			included.push({ id: comment.id, wire: classified.wire });
		} else {
			excluded.push({ id: comment.id, reason: classified.reason });
		}
	}
	return { included, excluded };
}

function classify(
	comment: EffectiveComment,
):
	| { kind: "included"; wire: ReviewComment }
	| { kind: "excluded"; reason: PublishExclusionReason } {
	if (comment.lane === "pre-existing") {
		return { kind: "excluded", reason: "pre-existing" };
	}
	if (comment.placement.kind === "unplaceable") {
		return { kind: "excluded", reason: "unplaceable" };
	}
	const side = comment.placement.side === "old" ? "LEFT" : "RIGHT";
	// only an `exact` placement ever carries a genuine range (TASK-040);
	// `clamped` anchors a single nearest line, so only `line` is sent
	const isRange =
		comment.placement.kind === "exact" && comment.startLine !== comment.endLine;
	return {
		kind: "included",
		wire: {
			path: comment.path,
			line: comment.placement.line,
			side,
			body: comment.body,
			...(isRange ? { startLine: comment.startLine, startSide: side } : {}),
		},
	};
}
