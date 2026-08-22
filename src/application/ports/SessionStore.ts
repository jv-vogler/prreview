import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { ReviewPass } from "../review/reviewSchema";

/**
 * The `.prreview/` store: the review pass artifact, kept so a page reload
 * or a server restart does not lose it. One artifact per changeset
 * (ASSUMPTION-003 — one review pass, no rounds, no history) rather than the
 * rounds/coverage/chat layout of the old implementation.
 */
export interface StoredReview {
	changesetId: ChangesetId;
	createdAt: string;
	pass: ReviewPass;
	/** files SEC-003's residue check found left behind by the run, if any */
	residue: string[];
}

export interface SessionStore {
	loadReview(changesetId: ChangesetId): Promise<StoredReview | null>;
	/** debounced; resolves once the artifact is on disk */
	saveReview(review: StoredReview): Promise<void>;
	/**
	 * Registers `.prreview/` in `<gitCommonDir>/info/exclude` — never in the
	 * user's own .gitignore. Idempotent.
	 */
	ensureExcluded(gitCommonDir: string): Promise<void>;
	/** writes everything still sitting in the debounce window, now */
	flush(): Promise<void>;
}
