import type { FileDiffDto } from "@dto/ChangesetDto";
import { useCoverageActions } from "../coverage/CoverageProvider";
import styles from "./FileViewedToggle.module.css";

/**
 * GitHub's "Viewed" box.
 *
 * It replaced a scroll observer that marked a file read once half its rows had
 * passed through the viewport. That measured the wrong thing: scrolling is not
 * reading, review is not linear, and a percentage built out of scroll position
 * told the reader how far down the page they had got while claiming to tell
 * them what they had checked. Ticking the box is a claim only a person can
 * make, and it folds the file away the way GitHub does — reopenable, because
 * having read something once is not a reason to be unable to look again.
 *
 * The fold control it used to sit beside now lives at the other end of the
 * header (`FileFoldChevron`), where a disclosure triangle belongs.
 */

export interface FileViewedToggleProps {
	file: FileDiffDto;
	/** from the server's per-file coverage: every hunk accounted for */
	viewed: boolean;
}

export function FileViewedToggle({ file, viewed }: FileViewedToggleProps) {
	const { setFileViewed } = useCoverageActions();
	const hunkIds = file.hunks.map((hunk) => hunk.id);

	return (
		// no stopPropagation, though the header this sits in folds on click:
		// `useHeaderFoldClicks` stops at the first control it meets on the way
		// up, and a label is a control. One rule, in one place, rather than every
		// slot remembering to defend itself.
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
	);
}
