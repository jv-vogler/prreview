import type { GoalMatchDto } from "@dto/TopicDto";
import { Link } from "react-router";
import { AnalysisInvitation } from "../view/analysis/AnalysisInvitation";
import { LoadingScreen } from "../view/general/LoadingScreen";
import { useUnderstanding } from "../view/understanding/useUnderstanding";
import styles from "./OverviewPage.module.css";

/**
 * `/overview` — what this change is for, and whether the code does it.
 *
 * Shares the comprehension pass with the Understanding tab: one run, two
 * screens, because they need the same reading of the change and paying twice
 * for it would be waste.
 */
export function OverviewPage() {
	const { understanding, loading } = useUnderstanding();

	if (loading) {
		return <LoadingScreen />;
	}

	if (understanding === null) {
		return (
			<AnalysisInvitation
				title="What is this change for?"
				body="prreview reads the code at this revision and works out what the change sets out to do, then says whether the code appears to do it."
				cost="One pass over the diff, shared with the Understanding tab — running it here fills both."
				actionLabel="Explain this change"
			/>
		);
	}

	const { goalMatch } = understanding;

	return (
		<div className={styles.page}>
			<section className={styles.block}>
				<h1 className={styles.heading}>What this change is for</h1>
				<p className={styles.summary}>{understanding.summary}</p>
			</section>

			{goalMatch.ticket !== null && (
				<section className={styles.block}>
					<h2 className={styles.subheading}>Ticket</h2>
					<p className={styles.ticket}>
						{goalMatch.ticket.url === undefined ? (
							<span className={styles.ticketKey}>{goalMatch.ticket.key}</span>
						) : (
							<a
								className={styles.ticketKey}
								href={goalMatch.ticket.url}
								target="_blank"
								rel="noreferrer"
							>
								{goalMatch.ticket.key}
							</a>
						)}
						<span className={styles.ticketSource}>
							found in the {goalMatch.ticket.source}
						</span>
					</p>
				</section>
			)}

			<GoalMatchBlock goalMatch={goalMatch} />

			<section className={styles.block}>
				<h2 className={styles.subheading}>Where to start</h2>
				<p className={styles.entry}>
					<Link
						to={`/diff?file=${encodeURIComponent(understanding.suggestedEntryPoint)}`}
					>
						{understanding.suggestedEntryPoint}
					</Link>
				</p>
				<p className={styles.next}>
					<Link to="/understand">Read the change as topics →</Link>
				</p>
			</section>
		</div>
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
		<section className={styles.block} data-goal-basis={goalMatch.basis}>
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
