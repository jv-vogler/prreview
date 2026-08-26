import type { ChangesetSource } from "./ChangesetSource";

export interface ChangesetRef {
	source: ChangesetSource;
	requestedAs?: string;
	baseSha: string;
	headSha: string | null;
	worktreeFingerprint?: string;
	resolvedAt: string;
	prUrl?: string;
}
