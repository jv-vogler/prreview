import { ChevronDownIcon } from "@primer/octicons-react";
import styles from "./FileFoldChevron.module.css";

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
			onClick={() => onToggle(fileId)}
			aria-expanded={!folded}
			aria-label={folded ? `Unfold ${path}` : `Fold ${path}`}
			data-file-fold={fileId}
			data-folded={folded ? "true" : "false"}
		>
			{}
			<ChevronDownIcon size={16} />
		</button>
	);
}
