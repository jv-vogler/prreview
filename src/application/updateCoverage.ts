import type { ChangesetId } from "../domain/changeset/ChangesetId";
import type { FileDiff } from "../domain/changeset/FileDiff";
import {
	type CoverageSummary,
	computeCoverage,
} from "../domain/coverage/computeCoverage";
import type { HunkCoverage } from "../domain/coverage/HunkCoverage";
import { upgradeHunkCoverage } from "../domain/coverage/upgradeHunkCoverage";
import type { SessionStore } from "./ports/SessionStore";

export interface UpdateCoverageDeps {
	store: SessionStore;
}

export interface CoverageUpdate {
	hunkId: string;
	state: HunkCoverage;
}

export interface UpdateCoverageInput {
	changesetId: ChangesetId;
	/** the current round's files — the universe of hunkIds that exist */
	files: readonly FileDiff[];
	coverage: Readonly<Record<string, HunkCoverage>>;
	updates: readonly CoverageUpdate[];
}

export interface UpdatedCoverage {
	coverage: Record<string, HunkCoverage>;
	/** for the `coverage.updated` SSE event and the PUT response */
	summary: CoverageSummary;
}

export type UpdateCoverage = (
	input: UpdateCoverageInput,
) => Promise<UpdatedCoverage>;

/**
 * Batched, idempotent, set-semantics coverage upsert (ARCHITECTURE §8):
 * upgrades are monotonic through the domain (viewed never downgrades
 * reviewed), hunkIds the current round does not know are dropped (a client
 * racing a refresh), and persistence rides the store's debounce without
 * making the caller wait for the disk.
 */
export function makeUpdateCoverage(deps: UpdateCoverageDeps): UpdateCoverage {
	return async (input) => {
		const knownHunkIds = new Set(
			input.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)),
		);

		const coverage: Record<string, HunkCoverage> = { ...input.coverage };
		for (const update of input.updates) {
			if (!knownHunkIds.has(update.hunkId)) {
				continue;
			}
			const upgraded = upgradeHunkCoverage(
				coverage[update.hunkId] ?? "unseen",
				update.state,
			);
			if (upgraded !== "unseen") {
				coverage[update.hunkId] = upgraded;
			}
		}

		void deps.store.saveCoverage(input.changesetId, coverage);
		return { coverage, summary: computeCoverage(input.files, coverage) };
	};
}
