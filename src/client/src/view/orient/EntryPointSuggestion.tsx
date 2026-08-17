import type { FileDiffDto } from "@dto/ChangesetDto";
import { ArrowRightIcon } from "@primer/octicons-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { resolveEntryPoint } from "../../domain/analysis/resolveEntryPoint";
import { diffPathFor } from "../../pages/diffUrl";
import styles from "./EntryPointSuggestion.module.css";

export interface EntryPointSuggestionProps {
	/** the agent's suggested entry point: sometimes a path, sometimes a sentence */
	suggestion: string;
	files: readonly FileDiffDto[];
}

/**
 * Where to start reading, as the page's one primary action (F4). The agent
 * writes this field as prose, so the target is resolved out of it rather than
 * assumed to be a path; when it names nothing this round contains, the action
 * still works and simply opens the diff at its beginning.
 */
export function EntryPointSuggestion({
	suggestion,
	files,
}: EntryPointSuggestionProps) {
	const entryPoint = useMemo(
		() => resolveEntryPoint(suggestion, files),
		[suggestion, files],
	);
	const rationale = suggestion.trim();
	const rationaleAddsSomething =
		rationale !== "" && rationale !== entryPoint?.path;

	return (
		<div className={styles.entry}>
			<Link
				className={styles.action}
				to={
					entryPoint === null
						? "/diff"
						: diffPathFor(entryPoint.fileId, entryPoint.hunkId)
				}
			>
				{entryPoint === null ? (
					"Open the diff"
				) : (
					<>
						Start with <code className={styles.path}>{entryPoint.path}</code>
					</>
				)}
				<ArrowRightIcon size={16} />
			</Link>
			{rationaleAddsSomething && (
				<p className={styles.rationale}>{rationale}</p>
			)}
		</div>
	);
}
