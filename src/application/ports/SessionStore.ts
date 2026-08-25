import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { ReviewPass } from "../review/reviewSchema";

/**
 * The `.prreview/` store: the review pass artifact, kept so a page reload
 * or a server restart does not lose it. One artifact per changeset
 * (ASSUMPTION-003 — one review pass, no rounds, no history) rather than the
 * rounds/coverage/chat layout of the old implementation.
 */
/**
 * One finding's curation state (TASK-046), keyed by its id (`commentIdAt`).
 * Both fields are optional and additive: an absent entry means "as the
 * engine wrote it" — there is no separate "clean" representation to keep in
 * sync.
 */
export interface CommentEdit {
	/** overridden body text, replacing the engine's own wording */
	body?: string;
	/** true once the reader has removed this comment; kept so it can be restored */
	deleted?: boolean;
}

/**
 * What `publishReview` (TASK-050, TASK-053) left behind after sending a
 * pending review: enough to link back to it and to know which comments
 * made the cut, so a second pass can tell what is already out there.
 */
export interface PublishedRecord {
	reviewId: number;
	htmlUrl: string;
	publishedAt: string;
	commentIds: string[];
}

export interface StoredReview {
	changesetId: ChangesetId;
	createdAt: string;
	/**
	 * The head commit the pass reviewed — null for a worktree changeset,
	 * where there is no commit to name. What a later "review again" compares
	 * against to say how far the change has moved since.
	 */
	headSha: string | null;
	pass: ReviewPass;
	/** files SEC-003's residue check found left behind by the run, if any */
	residue: string[];
	/** per-finding curation state; keyed by the ids in `findingIds` */
	commentEdits: Record<string, CommentEdit>;
	/**
	 * One id per finding, in `pass.findings` order — the name a curation
	 * entry, a publish record and the wire all key on. Absent on a pass
	 * written before ids became data, where a finding is named by its
	 * position instead (see `commentIdAt`).
	 */
	findingIds?: string[];
	/**
	 * The number the next new finding's id is minted from. It only ever goes
	 * up, so a dropped finding's id can never be handed to a different
	 * finding later.
	 */
	nextFindingId?: number;
	/** null until this pass has been published at least once */
	published: PublishedRecord | null;
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
