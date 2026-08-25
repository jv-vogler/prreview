import type { ChangesetAnnounce } from "../../application/resolveChangeset";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { FileDiff } from "../../domain/changeset/FileDiff";

/**
 * What the CLI resolved for the target it was given: the ref, its
 * announcement, and the parsed files. One artifact per changeset still
 * (there are no rounds), but not one snapshot per process: commits made
 * while prreview is serving used to be invisible until a restart, which is
 * how a "review again" dialog could state a commit count that was already
 * wrong.
 */
export interface CurrentChangeset {
	ref: ChangesetRef;
	announce: ChangesetAnnounce;
	files: FileDiff[];
}

/**
 * Re-runs the resolution the CLI did at boot, for the same target. The CLI
 * owns what "the same target" means, so this state never learns the
 * positionals.
 */
export type ResolveCurrentChangeset = () => Promise<CurrentChangeset>;

export interface ReviewState {
	current(): CurrentChangeset;
	/**
	 * Resolves the target again and adopts the answer. A resolution that
	 * fails — a deleted branch, a closed PR, gh gone — leaves the last good
	 * snapshot in place and rethrows, so the server is never left with no
	 * changeset to serve.
	 */
	refresh(): Promise<CurrentChangeset>;
}

export function createReviewState(
	initial: CurrentChangeset,
	resolve: ResolveCurrentChangeset,
): ReviewState {
	let current = initial;
	return {
		current: () => current,
		async refresh() {
			current = await resolve();
			return current;
		},
	};
}
