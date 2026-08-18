import type { FileDiffDto } from "@dto/ChangesetDto";
import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { useCoverageActions } from "../coverage/CoverageProvider";
import styles from "./FileViewedToggle.module.css";

/**
 * GitHub's "Viewed" box, and a fold control beside it.
 *
 * These replace a scroll observer that marked a file read once half its rows
 * had passed through the viewport. That measured the wrong thing: scrolling is
 * not reading, review is not linear, and a percentage built out of scroll
 * position told the reader how far down the page they had got while claiming to
 * tell them what they had checked. Ticking the box is a claim only a person can
 * make, and it folds the file away the way GitHub does — reopenable, because
 * having read something once is not a reason to be unable to look again.
 */

export interface FileViewedToggleProps {
	file: FileDiffDto;
	/** from the server's per-file coverage: every hunk accounted for */
	viewed: boolean;
	folded: boolean;
}

export function FileViewedToggle({
	file,
	viewed,
	folded,
}: FileViewedToggleProps) {
	const { setFileViewed, toggleFold } = useCoverageActions();
	const hunkIds = file.hunks.map((hunk) => hunk.id);

	return (
		<span className={styles.group}>
			<button
				type="button"
				className={styles.fold}
				onClick={() => toggleFold(file.id, folded)}
				aria-expanded={!folded}
				aria-label={folded ? `Unfold ${file.path}` : `Fold ${file.path}`}
				data-file-fold={file.id}
			>
				{folded ? (
					<ChevronRightIcon size={16} />
				) : (
					<ChevronDownIcon size={16} />
				)}
			</button>
			<label className={styles.viewed}>
				<input
					type="checkbox"
					checked={viewed}
					onChange={(event) =>
						setFileViewed(file.id, hunkIds, event.target.checked)
					}
					data-file-viewed={file.id}
					// a file with no hunks (binary, mode-only, a pure rename) has
					// nothing to read and nothing to record
					disabled={hunkIds.length === 0}
				/>
				Viewed
			</label>
		</span>
	);
}
