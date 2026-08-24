import type { ChangesetSource } from "./ChangesetSource";

/** One resolved snapshot of a changeset; identity lives in ChangesetId. */
export interface ChangesetRef {
	source: ChangesetSource;
	requestedAs?: string;
	baseSha: string;
	/** null for worktree */
	headSha: string | null;
	worktreeFingerprint?: string;
	resolvedAt: string;
	/** the PR's own page, when the backend had metadata to give one; never synthesized */
	prUrl?: string;
}
