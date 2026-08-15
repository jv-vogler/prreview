import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import type { FileDiff } from "../domain/changeset/FileDiff";
import { carryCoverage } from "../domain/coverage/carryCoverage";
import type { HunkCoverage } from "../domain/coverage/HunkCoverage";
import type { SessionManifest } from "../domain/session/SessionManifest";
import type { Git } from "./ports/Git";
import type { GithubService } from "./ports/GithubService";
import type { SessionStore } from "./ports/SessionStore";
import { readChangesetFiles } from "./readChangesetFiles";
import { resolveSourceRef } from "./resolveChangeset";

export interface RefreshChangesetDeps {
	git: Git;
	githubService: GithubService | null;
	store: SessionStore;
}

export interface RefreshChangesetInput {
	manifest: SessionManifest;
	coverage: Readonly<Record<string, HunkCoverage>>;
}

export interface RefreshedChangeset {
	manifest: SessionManifest;
	roundId: string;
	ref: ChangesetRef;
	files: FileDiff[];
	coverage: Record<string, HunkCoverage>;
}

export type RefreshChangeset = (
	input: RefreshChangesetInput,
) => Promise<RefreshedChangeset>;

/**
 * The user's answer to the drift banner (ARCHITECTURE §12): re-resolve the
 * SAME source (identity never changes mid-session — that is what keys the
 * session), parse the new state into a fresh IR snapshot, open round r(N+1),
 * and carry coverage across as a plain hunkId intersection so the total
 * honestly drops for new work.
 */
export function makeRefreshChangeset(
	deps: RefreshChangesetDeps,
): RefreshChangeset {
	return async (input) => {
		const { manifest } = input;
		const ref = await resolveSourceRef(
			deps,
			manifest.source,
			currentRoundRequestedAs(manifest),
		);
		const files = await readChangesetFiles(deps, ref);
		const coverage = carryCoverage(input.coverage, files);

		const roundId = `r${manifest.rounds.length + 1}`;
		const updated: SessionManifest = {
			...manifest,
			rounds: [...manifest.rounds, { id: roundId, ref, runs: [] }],
			currentRound: roundId,
		};
		void deps.store.saveSessionManifest(updated);
		void deps.store.saveRoundChangeset(updated.changesetId, roundId, files);
		void deps.store.saveCoverage(updated.changesetId, coverage);

		return { manifest: updated, roundId, ref, files, coverage };
	};
}

function currentRoundRequestedAs(
	manifest: SessionManifest,
): string | undefined {
	const currentRound = manifest.rounds.find(
		(round) => round.id === manifest.currentRound,
	);
	return currentRound?.ref.requestedAs;
}
