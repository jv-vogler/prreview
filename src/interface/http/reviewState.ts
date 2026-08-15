import type { OpenedReview } from "../../application/openReview";
import type { RefreshedChangeset } from "../../application/refreshChangeset";
import type { HunkCoverage } from "../../domain/coverage/HunkCoverage";

/**
 * The in-memory "current session" between requests. Use-cases are stateless
 * on purpose (Phase 5): they take the current files/coverage/manifest and
 * return successors, and this holder — owned by the HTTP layer, the edge that
 * serves it — is where the successors land. The drift poller reads the
 * current ref through it, so a refresh mid-session redirects the next tick.
 */
export interface ReviewState {
	current(): OpenedReview;
	applyRefresh(refreshed: RefreshedChangeset): void;
	applyCoverage(coverage: Record<string, HunkCoverage>): void;
}

export function createReviewState(opened: OpenedReview): ReviewState {
	let current = opened;
	return {
		current: () => current,
		applyRefresh(refreshed) {
			current = {
				...current,
				manifest: refreshed.manifest,
				roundId: refreshed.roundId,
				ref: refreshed.ref,
				files: refreshed.files,
				coverage: refreshed.coverage,
			};
		},
		applyCoverage(coverage) {
			current = { ...current, coverage };
		},
	};
}
