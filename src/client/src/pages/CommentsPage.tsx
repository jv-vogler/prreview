import { Link } from "react-router";
import { AnalysisInvitation } from "../view/analysis/AnalysisInvitation";
import { useAnnotations } from "../view/annotations/useAnnotations";
import { FindingCard } from "../view/findings/FindingCard";
import { useFindingSelection } from "../view/findings/FindingSelectionProvider";
import { useAnnotationOps } from "../view/findings/useAnnotationOps";
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
	const ops = useAnnotationOps();

	/**
	 * Handles are assigned over **every** comment species, in stored order —
	 * the same rule the server applies when it resolves `F3` back to an id.
	 *
	 * Numbering only the findings here would mean `F3` referred to different
	 * comments on the two sides the moment a related finding existed, and the
	 * failure would be a dismissal landing on the wrong one. Handles exist so
	 * that a person, the chat lane, and the server agree; they have to be
	 * derived identically or they are worse than nothing.
	 */
	const handled = annotations.filter(
		(annotation) =>
			annotation.species === "finding" ||
			annotation.species === "related-finding",
	);
	const handleOf = (id: string) => {
		const index = handled.findIndex((annotation) => annotation.id === id);
		return index < 0 ? "—" : `F${index + 1}`;
	};

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

			{ops.rejections.length > 0 && (
				<div className={styles.rejections} role="alert">
					{ops.rejections.map((rejection) => (
						<p key={`${rejection.handle}:${rejection.reason}`}>
							{rejection.handle}: {rejection.reason}
						</p>
					))}
					<button type="button" onClick={ops.clearRejections}>
						Dismiss
					</button>
				</div>
			)}

			<div className={styles.list}>
				{active.map((finding) => (
					<FindingCard
						key={finding.id}
						finding={finding}
						handle={handleOf(finding.id)}
						selected={selection.selectedId === finding.id}
						onSelect={() => selection.select(finding.id)}
						onDrop={() =>
							ops.apply([{ op: "drop", handle: handleOf(finding.id) }])
						}
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
								handle={handleOf(finding.id)}
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
								handle={handleOf(finding.id)}
								selected={selection.selectedId === finding.id}
								onSelect={() => selection.select(finding.id)}
								onRestore={() =>
									ops.apply([{ op: "restore", handle: handleOf(finding.id) }])
								}
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
				body="Reads the diff several times over, looking for a different kind of problem each time, and merges what it finds into one list. Every comment is checked against what the agent actually read."
				cost="Several agent passes at once. The most expensive thing prreview does."
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
