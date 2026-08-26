import type { ChangesetAnnounce } from "../../application/resolveChangeset";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { FileDiff } from "../../domain/changeset/FileDiff";

export interface CurrentChangeset {
	ref: ChangesetRef;
	announce: ChangesetAnnounce;
	files: FileDiff[];
}

export type ResolveCurrentChangeset = () => Promise<CurrentChangeset>;

export interface ReviewState {
	current(): CurrentChangeset;
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
