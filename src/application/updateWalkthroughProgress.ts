import type { WalkthroughProgress } from "../domain/analysis/Walkthrough";
import { walkthroughHunkIds } from "../domain/analysis/Walkthrough";
import type { ChangesetId } from "../domain/changeset/ChangesetId";
import type { FileDiff } from "../domain/changeset/FileDiff";
import type { CoverageSummary } from "../domain/coverage/computeCoverage";
import type { HunkCoverage } from "../domain/coverage/HunkCoverage";
import { AnalysisError } from "../domain/errors/AnalysisError";
import { ValidationError } from "../domain/errors/ValidationError";
import { walkthroughFromComprehension } from "./analysis/walkthroughFromComprehension";
import type { SessionStore } from "./ports/SessionStore";
import type { UpdateCoverage } from "./updateCoverage";

export interface UpdateWalkthroughProgressDeps {
	store: SessionStore;
	updateCoverage: UpdateCoverage;
}

export interface UpdateWalkthroughProgressInput {
	changesetId: ChangesetId;
	roundId: string;
	/** the current round's files — the universe of hunkIds that exist */
	files: readonly FileDiff[];
	coverage: Readonly<Record<string, HunkCoverage>>;
	/** the step being entered, 0-based */
	position: number;
	completed: boolean;
}

export interface UpdatedWalkthroughProgress {
	progress: WalkthroughProgress;
	coverage: Record<string, HunkCoverage>;
	summary: CoverageSummary;
}

export type UpdateWalkthroughProgress = (
	input: UpdateWalkthroughProgressInput,
) => Promise<UpdatedWalkthroughProgress>;

/**
 * Entering a walkthrough step (ARCHITECTURE §7: "viewing a step marks its hunks
 * viewed"). In plain terms: the walkthrough is reading, and reading counts —
 * so one call both remembers where the reader is and moves coverage, and the
 * response carries the fresh percentage so the ring never has to be computed in
 * the browser (REQ-008).
 *
 * Replaying a step is harmless: coverage upgrades run through the domain's
 * monotonic path, so a hunk already reviewed is never downgraded to viewed.
 */
export function makeUpdateWalkthroughProgress(
	deps: UpdateWalkthroughProgressDeps,
): UpdateWalkthroughProgress {
	return async (input) => {
		const analysis = await deps.store.loadRoundAnalysis(
			input.changesetId,
			input.roundId,
		);
		if (analysis === null) {
			throw new AnalysisError(
				"not-produced",
				"This round has no walkthrough yet: run an analysis first.",
			);
		}
		const walkthrough = walkthroughFromComprehension(analysis.comprehension);
		const step = walkthrough.steps[input.position];
		if (step === undefined) {
			throw new ValidationError(
				`This walkthrough has ${walkthrough.steps.length} steps, so step ${input.position} does not exist.`,
			);
		}

		const { coverage, summary } = await deps.updateCoverage({
			changesetId: input.changesetId,
			files: input.files,
			coverage: input.coverage,
			updates: walkthroughHunkIds(step).map((hunkId) => ({
				hunkId,
				state: "viewed" as const,
			})),
		});

		const progress: WalkthroughProgress = {
			position: input.position,
			completed: input.completed,
		};
		await deps.store.saveWalkthroughProgress(input.changesetId, progress);

		return { progress, coverage, summary };
	};
}
