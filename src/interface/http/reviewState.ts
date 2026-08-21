import type { ChangesetAnnounce } from "../../application/resolveChangeset";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { FileDiff } from "../../domain/changeset/FileDiff";

/**
 * What the CLI resolved at boot: the ref, its announcement, and the parsed
 * files. One review pass per process for now — there is no round, no
 * refresh, and no persistence yet (those are Phase 4's SessionStore and
 * later phases' concerns); this is deliberately just a holder, not a
 * service, and nothing here mutates.
 */
export interface CurrentChangeset {
	ref: ChangesetRef;
	announce: ChangesetAnnounce;
	files: FileDiff[];
}

export interface ReviewState {
	current(): CurrentChangeset;
}

export function createReviewState(initial: CurrentChangeset): ReviewState {
	return { current: () => initial };
}
