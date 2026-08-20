import { useState } from "react";
import { Link } from "react-router";
import { AnalysisInvitation } from "../view/analysis/AnalysisInvitation";
import { useAnalysis } from "../view/analysis/AnalysisProvider";
import { useAnnotationsQuery } from "../view/annotations/useAnnotations";
import type { DepthChoice } from "../view/findings/DepthPicker";
import { DepthPicker } from "../view/findings/DepthPicker";
import { DiscardedSummary } from "../view/findings/DiscardedSummary";
import { FindingCard } from "../view/findings/FindingCard";
import { useFindingSelection } from "../view/findings/FindingSelectionProvider";
import { useAnnotationOps } from "../view/findings/useAnnotationOps";
import { useReviewSummary } from "../view/findings/useReviewSummary";
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
	const { annotations, loading } = useAnnotationsQuery();
	const selection = useFindingSelection();
	const ops = useAnnotationOps();
	const summary = useReviewSummary();

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

	/*
	 * "Not back yet" is not "there are none".
	 *
	 * This used to render the invitation while the first fetch was still out, so
	 * reloading during a review flashed "run a review" at somebody whose review
	 * was already running — an offer to spend again on the thing in flight.
	 */
	if (loading) {
		return <p className={styles.footnote}>Loading suggested comments…</p>;
	}

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

			{summary !== null && <DiscardedSummary summary={summary} />}

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
 *
 * The depth choice lives here rather than inside the invitation, which is shared
 * with the Understanding tab and has no business knowing what a lens is. It
 * arrives as a slot and an `onAction`, so the comprehension path is untouched.
 */
function NoFindingsYet() {
	const analysis = useAnalysis();
	const [depth, setDepth] = useState<DepthChoice>("standard");
	const running = analysis.activeRun !== null || analysis.starting;

	return (
		<>
			<AnalysisInvitation
				task="review"
				title="Review this change for problems"
				body="Reads the diff several times over, looking for a different kind of problem each time, and merges what it finds into one list. Every comment is checked against what the agent actually read."
				cost="Several agent passes at once. The most expensive thing prreview does."
				actionLabel="Review this change"
				controls={
					<DepthPicker value={depth} onChange={setDepth} disabled={running} />
				}
				// only the preset goes on the wire: the lens locks and the floor are
				// applied where the depth is built, not asked for here
				onAction={() => analysis.startReview({ preset: depth })}
			/>
			<p className={styles.footnote}>
				Separate from understanding the change on purpose, so reading about a PR
				never quietly spends on a review you did not ask for.{" "}
				<Link to="/understand">What does this change do? →</Link>
			</p>
		</>
	);
}
