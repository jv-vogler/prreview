import type { ChangesetSource } from "./ChangesetSource";

/** One resolved snapshot of a changeset; identity lives in ChangesetId (ARCHITECTURE §5). */
export interface ChangesetRef {
	source: ChangesetSource;
	requestedAs?: string;
	baseSha: string;
	/** null for worktree */
	headSha: string | null;
	worktreeFingerprint?: string;
	resolvedAt: string;
}
