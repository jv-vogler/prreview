import type { RoundAnalysis } from "../../application/analysis/RoundAnalysis";
import type { OpenedReview } from "../../application/openReview";
import type { SessionStore } from "../../application/ports/SessionStore";
import type { RefreshedChangeset } from "../../application/refreshChangeset";
import type { StoredAnnotation } from "../../domain/annotation/Annotation";
import type { HunkCoverage } from "../../domain/coverage/HunkCoverage";

/**
 * The in-memory "current session" between requests. Use-cases are stateless
 * on purpose (Phase 5): they take the current files/coverage/manifest and
 * return successors, and this holder — owned by the HTTP layer, the edge that
 * serves it — is where the successors land. The drift poller reads the
 * current ref through it, so a refresh mid-session redirects the next tick.
 *
 * Annotations and the round's analysis work the other way around: they are
 * produced minutes after the request that asked for them, by a run in the
 * background, so this holder caches them and the events that can change them
 * drop the cache. A read after a drop goes to the store, which is the truth —
 * so a route can never serve a stale intent map, and never has to guess whether
 * a background run has landed yet.
 */
export interface ReviewState {
	current(): OpenedReview;
	applyRefresh(refreshed: RefreshedChangeset): void;
	applyCoverage(coverage: Record<string, HunkCoverage>): void;
	/** the current round's annotations */
	annotations(): Promise<readonly StoredAnnotation[]>;
	/** the known set, or null to forget it and re-read on the next request */
	applyAnnotations(annotations: readonly StoredAnnotation[] | null): void;
	/** the current round's stage-A output, absent until an analysis succeeded */
	analysis(): Promise<RoundAnalysis | null>;
	/** the produced analysis, or null to forget it and re-read on the next request */
	applyAnalysis(analysis: RoundAnalysis | null): void;
}

export function createReviewState(
	opened: OpenedReview,
	store: SessionStore,
): ReviewState {
	let current = opened;
	let annotations: readonly StoredAnnotation[] | null = null;
	let analysis: RoundAnalysis | null = null;

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
			// the new round carries the re-anchored notes and no analysis of its
			// own: stage A ran against the round that just became history
			annotations = refreshed.annotations.carried;
			analysis = null;
		},

		applyCoverage(coverage) {
			current = { ...current, coverage };
		},

		async annotations() {
			if (annotations === null) {
				annotations = await store.loadAnnotations(current.manifest.changesetId);
			}
			return annotations;
		},

		applyAnnotations(next) {
			annotations = next;
		},

		async analysis() {
			if (analysis === null) {
				analysis = await store.loadRoundAnalysis(
					current.manifest.changesetId,
					current.roundId,
				);
			}
			return analysis;
		},

		applyAnalysis(next) {
			analysis = next;
		},
	};
}
