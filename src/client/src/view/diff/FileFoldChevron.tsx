import { ChevronDownIcon } from "@primer/octicons-react";
import styles from "./FileFoldChevron.module.css";

/**
 * The fold control, at the far left of the file header.
 *
 * This slot — Pierre's `header-prefix`, which renders immediately before the
 * change-type icon — is where a disclosure triangle belongs and where every
 * file tree in every editor puts one.
 *
 * The whole header is clickable too (`useHeaderFoldClicks`); this is the
 * affordance that says so, and the keyboard's way in.
 */

export interface FileFoldChevronProps {
	fileId: string;
	path: string;
	folded: boolean;
	onToggle(fileId: string): void;
}

export function FileFoldChevron({
	fileId,
	path,
	folded,
	onToggle,
}: FileFoldChevronProps) {
	return (
		<button
			type="button"
			className={styles.fold}
			// the header's delegated handler stops at the first control on the
			// way up, so this click is this button's alone
			onClick={() => onToggle(fileId)}
			aria-expanded={!folded}
			aria-label={folded ? `Unfold ${path}` : `Fold ${path}`}
			data-file-fold={fileId}
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
