import type { FileDiffDto } from "@dto/ChangesetDto";
import { ChevronDownIcon } from "@primer/octicons-react";
import { useCoverageActions } from "../coverage/CoverageProvider";
import styles from "./FileFoldChevron.module.css";

/**
 * The fold control, at the far left of the file header.
 *
 * It used to sit beside the "Viewed" box at the right-hand end, which put the
 * thing that opens a file at the opposite side of the bar from where a reader
 * looks to see what the file is. This slot — Pierre's `header-prefix`, which
 * renders immediately before the change-type icon — is where a disclosure
 * triangle belongs and where every file tree in every editor puts one.
 *
 * The whole header is clickable too (`useHeaderFoldClicks`); this is the
 * affordance that says so, and the keyboard's way in.
 */

export interface FileFoldChevronProps {
	file: FileDiffDto;
	folded: boolean;
}

export function FileFoldChevron({ file, folded }: FileFoldChevronProps) {
	const { toggleFold } = useCoverageActions();

	return (
		<button
			type="button"
			className={styles.fold}
			// the header's delegated handler stops at the first control on the
			// way up, so this click is this button's alone
			onClick={() => toggleFold(file.id, folded)}
			aria-expanded={!folded}
			aria-label={folded ? `Unfold ${file.path}` : `Fold ${file.path}`}
			data-file-fold={file.id}
			data-folded={folded ? "true" : "false"}
		>
			{/*
				One icon that turns, rather than two that swap. A swap cannot be
				animated — there is nothing continuous between two different glyphs —
				and the rotation is what makes the fold read as the same object
				changing state rather than as the bar being redrawn.
			*/}
			<ChevronDownIcon size={16} />
		</button>
	);
}
