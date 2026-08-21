import type { FileDiffDto } from "@dto/ChangesetDto";
import { FileBinaryIcon, FileDiffIcon } from "@primer/octicons-react";
import styles from "./FileTreePanel.module.css";

export interface FileTreePanelProps {
	files: readonly FileDiffDto[];
	currentFileIndex: number;
	onJumpToFile(index: number): void;
}

/** The file panel: every changed file, in the order the diff carries them. */
export function FileTreePanel({
	files,
	currentFileIndex,
	onJumpToFile,
}: FileTreePanelProps) {
	return (
		<nav className={styles.panel} aria-label="Changed files">
			<h2 className={styles.heading}>
				Files <span className={styles.fileCount}>{files.length}</span>
			</h2>
			<ul className={styles.list}>
				{files.map((file, index) => (
					<li
						key={file.id}
						/*
							A folder boundary keeps a directory's files together, so a
							directory change really is the boundary between two groups
							rather than an accident of order. A little air is all it takes
							to read the list as a handful of areas instead of one long run
							of paths.
						*/
						data-group-start={
							index > 0 &&
							directoryOf(file.path) !==
								directoryOf(files[index - 1]?.path ?? "")
								? "true"
								: undefined
						}
					>
						<button
							type="button"
							className={styles.file}
							aria-current={index === currentFileIndex ? "true" : undefined}
							onClick={() => onJumpToFile(index)}
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
