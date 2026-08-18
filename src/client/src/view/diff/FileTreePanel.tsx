import type { FileDiffDto } from "@dto/ChangesetDto";
import {
	BookIcon,
	CheckCircleFillIcon,
	FileBinaryIcon,
	FileDiffIcon,
} from "@primer/octicons-react";
import { useMemo } from "react";
import { countNotesByFileId } from "../../domain/annotation/countNotesByFileId";
import { directoryOf } from "../../domain/changeset/sortFilesByAttention";
import { useAnnotations } from "../annotations/useAnnotations";
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
	const annotations = useAnnotations();
	const noteCounts = useMemo(
		() => countNotesByFileId(annotations),
		[annotations],
	);

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
							The attention order keeps a folder's files together, so a
							directory change really is the boundary between two groups
							rather than an accident of line counts. A little air is all it
							takes to read the list as a handful of areas instead of one
							long run of paths.
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
								<NoteCount count={noteCounts.get(file.id) ?? 0} />
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

/**
 * How many notes this file carries. Absent at zero, so a session with no
 * analysis (or no agent at all) leaves the panel exactly as M1 drew it.
 */
function NoteCount({ count }: { count: number }) {
	if (count === 0) {
		return null;
	}
	return (
		<span
			className={styles.noteCount}
			title={count === 1 ? "1 note" : `${count} notes`}
		>
			<BookIcon size={12} />
			{count}
		</span>
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

function basenameOf(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}
