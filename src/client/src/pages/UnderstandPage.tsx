import type { FileDiffMetadata } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { useMemo } from "react";
import { topicCoverageFractions } from "../domain/analysis/topicCoverage";
import { buildPatchText } from "../domain/changeset/buildPatchText";
import { AnalysisInvitation } from "../view/analysis/AnalysisInvitation";
import { useGuaranteedChangeset } from "../view/diff/useGuaranteedChangeset";
import { LoadingScreen } from "../view/general/LoadingScreen";
import { TopicBlock } from "../view/understanding/TopicBlock";
import { useUnderstanding } from "../view/understanding/useUnderstanding";
import styles from "./UnderstandPage.module.css";

/**
 * `/understand` — the change retold as plain-language topics, each carrying the
 * code that serves it.
 *
 * This is where the guided walkthrough ended up. It was the same idea — read
 * this change in a sensible order, with someone explaining as you go — rendered
 * in the wrong place: a modal rail over a diff, where the narration and the
 * code it described were never on screen together. Here they are one block.
 */
export function UnderstandPage() {
	const { understanding, loading } = useUnderstanding();
	const changeset = useGuaranteedChangeset();

	const parsedByPath = useMemo(() => {
		const withHunks = changeset.files.filter((file) => file.hunks.length > 0);
		const parsed = parsePatchFiles(
			buildPatchText(withHunks),
			changeset.roundId,
		);
		const byPath = new Map<string, FileDiffMetadata>();
		for (const fileDiff of parsed[0]?.files ?? []) {
			byPath.set(fileDiff.name, fileDiff);
		}
		return byPath;
	}, [changeset.files, changeset.roundId]);

	const filesByPath = useMemo(
		() => new Map(changeset.files.map((file) => [file.path, file])),
		[changeset.files],
	);

	const coverage = useMemo(
		() =>
			understanding === null
				? []
				: topicCoverageFractions(understanding.topics, changeset.files),
		[understanding, changeset.files],
	);

	if (loading) {
		return <LoadingScreen />;
	}

	if (understanding === null) {
		return (
			<AnalysisInvitation
				title="Understand this change"
				body="prreview reads the code at this revision and retells the change as a handful of plain-language topics, each one carrying the hunks that serve it."
				cost="One pass over the diff, with the agent reading files to ground what it says. Minutes, not seconds, on a large change."
				actionLabel="Explain this change"
			/>
		);
	}

	return (
		<div className={styles.page}>
			<header className={styles.intro}>
				<h1 className={styles.heading}>What this change does</h1>
				<p className={styles.summary}>{understanding.summary}</p>
				<p className={styles.hint}>
					Topics overlap where one hunk does two things, so the percentages do
					not add up to 100%.
				</p>
			</header>

			<div className={styles.topics}>
				{understanding.topics.map((topic, index) => (
					<TopicBlock
						key={topic.id}
						topic={topic}
						coverage={coverage[index] ?? 0}
						parsedByPath={parsedByPath}
						filesByPath={filesByPath}
					/>
				))}
			</div>

			{understanding.uncoveredHunks.length > 0 && (
				<UncoveredNotice count={understanding.uncoveredHunks.length} />
			)}
		</div>
	);
}

/**
 * Says out loud what the pass did not account for.
 *
 * A run that grouped the two obvious things and quietly ignored thirty files
 * still returns a well-formed object. Without this, the page would present that
 * as a complete account of the change, which is the most expensive kind of
 * wrong a comprehension tool can be.
 */
function UncoveredNotice({ count }: { count: number }) {
	return (
		<p className={styles.uncovered} data-uncovered-count={count}>
			{count === 1
				? "1 hunk is not covered by any topic above."
				: `${count} hunks are not covered by any topic above.`}{" "}
			The Diff tab has everything.
		</p>
	);
}
