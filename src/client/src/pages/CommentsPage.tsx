import { Link } from "react-router";
import { AnalysisInvitation } from "../view/analysis/AnalysisInvitation";
import { useAnnotations } from "../view/annotations/useAnnotations";
import { FindingCard } from "../view/findings/FindingCard";
import { useFindingSelection } from "../view/findings/FindingSelectionProvider";
import styles from "./CommentsPage.module.css";

/**
 * `/comments` — candidate review comments, as a working list.
 *
 * These are the same findings the Diff tab shows as balloons: one query, two
 * surfaces. The list is where you triage them; the diff is where you check one
 * against its surroundings.
 *
 * Related findings — problems that were already there, noticed in passing —
 * sit in their own section and never mix into the review feedback. A reviewer
 * pasting comments onto someone's PR must never accidentally hand them a
 * complaint about code the change did not touch.
 */
export function CommentsPage() {
	const annotations = useAnnotations();
	const selection = useFindingSelection();

	const findings = annotations.filter(
		(annotation) => annotation.species === "finding",
	);
	const related = annotations.filter(
		(annotation) => annotation.species === "related-finding",
	);
	const active = findings.filter(
		(finding) => finding.curation?.state !== "dismissed",
	);
	const dismissed = findings.filter(
		(finding) => finding.curation?.state === "dismissed",
	);

	if (findings.length === 0 && related.length === 0) {
		return <NoFindingsYet />;
	}

	return (
		<div className={styles.page}>
			<header className={styles.intro}>
				<h1 className={styles.heading}>Suggested comments</h1>
				<p className={styles.hint}>
					{active.length === 0
						? "Nothing to raise on this change."
						: `${active.length} candidate ${active.length === 1 ? "comment" : "comments"}. Nothing is posted anywhere — this is a scratchpad.`}
				</p>
			</header>

			<div className={styles.list}>
				{active.map((finding, index) => (
					<FindingCard
						key={finding.id}
						finding={finding}
						handle={`F${index + 1}`}
						selected={selection.selectedId === finding.id}
						onSelect={() => selection.select(finding.id)}
					/>
				))}
			</div>

			{related.length > 0 && (
				<section className={styles.section}>
					<h2 className={styles.sectionHeading}>
						Noticed nearby, not from this change
					</h2>
					<p className={styles.hint}>
						Pre-existing problems the agent saw while reading. Kept separate so
						they never end up in review feedback about someone else's work.
					</p>
					<div className={styles.list}>
						{related.map((finding) => (
							<FindingCard
								key={finding.id}
								finding={finding}
								handle="—"
								selected={selection.selectedId === finding.id}
								onSelect={() => selection.select(finding.id)}
							/>
						))}
					</div>
				</section>
			)}

			{dismissed.length > 0 && (
				<section className={styles.section}>
					<h2 className={styles.sectionHeading}>
						Dismissed ({dismissed.length})
					</h2>
					<div className={styles.list}>
						{dismissed.map((finding) => (
							<FindingCard
								key={finding.id}
								finding={finding}
								handle="—"
								selected={selection.selectedId === finding.id}
								onSelect={() => selection.select(finding.id)}
								dimmed
							/>
						))}
					</div>
				</section>
			)}
		</div>
	);
}

/**
 * The invitation states its own cost and starts the findings pass — and only
 * that pass. It deliberately refuses to silently chain a comprehension run: a
 * reviewer who asked for comments asked for comments.
 */
function NoFindingsYet() {
	return (
		<>
			<AnalysisInvitation
				task="review"
				title="Review this change for problems"
				body="Several independent readings of the diff — correctness, security, edge cases, and more — merged into one list of comments worth making. Each one is checked against what the agent actually read before it is shown."
				cost="Several passes running together, each reading files to ground its claims. The most expensive thing prreview does; minutes on a large change."
				actionLabel="Review this change"
			/>
			<p className={styles.footnote}>
				Separate from understanding the change on purpose, so reading about a PR
				never quietly spends on a review you did not ask for.{" "}
				<Link to="/understand">What does this change do? →</Link>
			</p>
		</>
	);
}
