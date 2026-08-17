import type { FileDiffDto } from "@dto/ChangesetDto";
import type { WalkthroughDto } from "@dto/WalkthroughDto";
import type { DiffPosition } from "../changeset/DiffPosition";

/** one step of the guided reading order, as the wire carries it */
export type WalkthroughStepDto = WalkthroughDto["steps"][number];

/**
 * Where a step wants the reader to look, as a position in the rendered file
 * order (F5: "entering a step scrolls to its first focus hunk").
 *
 * A step names paths and hunk ids; both can go stale, and the two failures are
 * not equally bad. A path this round does not contain means the step is about
 * code that is no longer here, so the next focus entry gets its turn. A path
 * that IS here with hunk ids that are not still tells the reader something
 * true — read this file — so it lands on the file's first hunk rather than
 * being dropped. `null` means no focus entry named anything this round holds,
 * and the caller should not scroll at all.
 */
export function resolveStepTarget(
	step: WalkthroughStepDto,
	files: readonly FileDiffDto[],
): DiffPosition | null {
	for (const focus of step.focus) {
		const fileIndex = files.findIndex((file) => file.path === focus.path);
		const file = files[fileIndex];
		if (file === undefined) {
			continue;
		}
		const hunkIndex = file.hunks.findIndex((hunk) =>
			focus.hunkIds.includes(hunk.id),
		);
		return { fileIndex, hunkIndex: hunkIndex === -1 ? 0 : hunkIndex };
	}
	return null;
}
