import type { GoalMatchDto } from "@dto/TopicDto";
import type { FileDiffMetadata } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { useMemo } from "react";
import { Link } from "react-router";
import { topicCoverageFractions } from "../domain/analysis/topicCoverage";
import { buildPatchText } from "../domain/changeset/buildPatchText";
import { AnalysisInvitation } from "../view/analysis/AnalysisInvitation";
import { useGuaranteedChangeset } from "../view/diff/useGuaranteedChangeset";
import { LoadingScreen } from "../view/general/LoadingScreen";
import { TopicBlock } from "../view/understanding/TopicBlock";
import { useUnderstanding } from "../view/understanding/useUnderstanding";
import styles from "./UnderstandPage.module.css";

/**
 * `/understand` — what this change is for, and the change retold as topics,
 * each carrying the code that serves it.
 *
 * The purpose and the topics were two tabs and are now one screen, because
 * splitting them made a reader pay two clicks to get one thought: the summary
 * and the verdict are the lead paragraph of the same account the topics
 * continue. They always came from one pass over the diff, and now they read
 * like it.
 *
 * This is also where the guided walkthrough ended up. It was the same idea —
 * read this change in a sensible order, with someone explaining as you go —
 * rendered in the wrong place: a modal rail over a diff, where the narration
 * and the code it described were never on screen together.
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
				body="prreview reads the code at this revision, works out what the change sets out to do, and retells it as a handful of plain-language topics — each one carrying the hunks that serve it."
				cost="One pass over the diff, with the agent reading files to ground what it says. Minutes, not seconds, on a large change."
				actionLabel="Explain this change"
			/>
		);
	}

	const { goalMatch } = understanding;

	return (
		<div className={styles.page}>
			<header className={styles.intro}>
				<h1 className={styles.heading}>What this change is for</h1>
				<p className={styles.summary}>{understanding.summary}</p>
				{goalMatch.ticket !== null && <Ticket ticket={goalMatch.ticket} />}
			</header>

			<GoalMatchBlock goalMatch={goalMatch} />

			<section className={styles.topicsSection}>
				<h2 className={styles.subheading}>What it does, topic by topic</h2>
				<p className={styles.hint}>
					Topics overlap where one hunk does two things, so the percentages do
					not add up to 100%.{" "}
					<Link
						to={`/diff?file=${encodeURIComponent(understanding.suggestedEntryPoint)}`}
					>
						Start reading at {understanding.suggestedEntryPoint}
					</Link>
					.
				</p>

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
			</section>

			{understanding.uncoveredHunks.length > 0 && (
				<UncoveredNotice count={understanding.uncoveredHunks.length} />
			)}
		</div>
	);
}

function Ticket({ ticket }: { ticket: NonNullable<GoalMatchDto["ticket"]> }) {
	return (
		<p className={styles.ticket}>
			{ticket.url === undefined ? (
				<span className={styles.ticketKey}>{ticket.key}</span>
			) : (
				<a
					className={styles.ticketKey}
					href={ticket.url}
					target="_blank"
					rel="noreferrer"
				>
					{ticket.key}
				</a>
			)}
			<span className={styles.ticketSource}>found in the {ticket.source}</span>
		</p>
	);
}

const VERDICT_LABEL: Record<GoalMatchDto["verdict"], string> = {
	matches: "The code does what it set out to do",
	partly: "The code does part of what it set out to do",
	diverges: "The code does something materially different",
	unclear: "The intent could not be determined from the code",
};

/**
 * The verdict, phrased by its own basis.
 *
 * `basis` decides the wording, and it is stamped by the server from whether a
 * ticket was actually discovered — never taken from the agent. Saying "matches
 * ENG-4471" when no ticket was ever found would be an invented authority, and
 * it is the single most damaging thing this screen could do.
 */
function GoalMatchBlock({ goalMatch }: { goalMatch: GoalMatchDto }) {
	const grounded = goalMatch.basis === "ticket" && goalMatch.ticket !== null;

	return (
		<section className={styles.verdictBlock} data-goal-basis={goalMatch.basis}>
			<h2 className={styles.subheading}>
				{grounded
					? `Does it do what ${goalMatch.ticket?.key} asks?`
					: "Is the change internally coherent?"}
			</h2>
			<p className={styles.verdict} data-verdict={goalMatch.verdict}>
				{VERDICT_LABEL[goalMatch.verdict]}
			</p>
			<p className={styles.rationale}>{goalMatch.rationale}</p>
			<p className={styles.basis}>
				{grounded
					? `Judged against ${goalMatch.ticket?.key}, which prreview found but has not read — it has no access to the ticket's text.`
					: "No ticket was found for this change, so this judges only whether the parts of the change serve one evident purpose."}
			</p>
		</section>
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
