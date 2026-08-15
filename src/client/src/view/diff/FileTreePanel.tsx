import type { FileDiffDto } from "@dto/ChangesetDto";
import {
	CheckCircleFillIcon,
	FileBinaryIcon,
	FileDiffIcon,
} from "@primer/octicons-react";
import { useGuaranteedSession } from "../session/useGuaranteedSession";
import { useDiffNavigation } from "./DiffNavigationProvider";
import styles from "./FileTreePanel.module.css";

const FULLY_COVERED_PERCENT = 100;

/**
 * The file panel (TASK-047): files in attention order (domain rule — changed
 * lines descending, generated last) with a per-file coverage tick fed by the
 * server's byFile summary. Clicking a file moves the cursor and scrolls the
 * workspace.
 */
export function FileTreePanel() {
	const { files, cursor, jumpToFile } = useDiffNavigation();
	const session = useGuaranteedSession();

	return (
		<nav className={styles.panel} aria-label="Changed files">
			<h2 className={styles.heading}>
				Files <span className={styles.fileCount}>{files.length}</span>
			</h2>
			<ul className={styles.list}>
				{files.map((file, index) => (
					<li key={file.id}>
						<button
							type="button"
							className={styles.file}
							aria-current={index === cursor.fileIndex ? "true" : undefined}
							onClick={() => jumpToFile(index)}
						>
							<span className={styles.fileIcon}>
								{file.isBinary ? (
									<FileBinaryIcon size={16} />
								) : (
									<FileDiffIcon size={16} />
								)}
							</span>
							<span className={styles.path} title={file.path}>
								{directoryOf(file.path) !== "" && (
									<span className={styles.directory}>
										{directoryOf(file.path)}/
									</span>
								)}
								{basenameOf(file.path)}
							</span>
							<span className={styles.meta}>
								<ChangedLines file={file} />
								<span className={styles.tick}>
									{(session.coverage.byFile[file.id] ?? 0) >=
										FULLY_COVERED_PERCENT && (
										<CheckCircleFillIcon size={12} aria-label="Fully covered" />
									)}
								</span>
							</span>
						</button>
					</li>
				))}
			</ul>
		</nav>
	);
}

function ChangedLines({ file }: { file: FileDiffDto }) {
	if (file.isBinary) {
		return <span className={styles.binaryTag}>binary</span>;
	}
	return (
		<span className={styles.counts}>
			{file.additions > 0 && (
				<span className={styles.additions}>+{file.additions}</span>
			)}
			{file.deletions > 0 && (
				<span className={styles.deletions}>−{file.deletions}</span>
			)}
		</span>
	);
}

function directoryOf(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}

function basenameOf(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}
