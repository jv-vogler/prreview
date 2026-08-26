import styles from "./FileViewedToggle.module.css";

export interface FileViewedToggleProps {
	fileId: string;
	path: string;
	viewed: boolean;
	onToggle(fileId: string): void;
}

export function FileViewedToggle({
	fileId,
	path,
	viewed,
	onToggle,
}: FileViewedToggleProps) {
	return (
		<label className={styles.viewed} data-file-viewed={fileId}>
			<input
				type="checkbox"
				checked={viewed}
				aria-label={`Mark ${path} viewed`}
				onChange={() => onToggle(fileId)}
			/>
			Viewed
		</label>
	);
}
