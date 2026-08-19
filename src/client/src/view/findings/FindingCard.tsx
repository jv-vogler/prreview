import { Link } from "react-router";
import type {
	Finding,
	RelatedFinding,
} from "../../domain/annotation/Annotation";
import styles from "./FindingCard.module.css";

/**
 * One candidate review comment.
 *
 * Laid out the way a reviewer's own scratchfile is: a short handle to refer to
 * it by, where it lands, what it says, and how much to trust it. The handle
 * matters more than it looks — it is how a person and the chat lane name the
 * same finding without either guessing.
 *
 * The body is shown as-is. It was written to be pasted into a review comment,
 * so anything this card added around it would have to be stripped back out.
 */

export interface FindingCardProps {
	finding: Finding | RelatedFinding;
	/** stable short handle in display order: F1, F2, … */
	handle: string;
	selected: boolean;
	onSelect(): void;
	dimmed?: boolean;
	/** curation actions; absent on surfaces that only display */
	onDrop?(): void;
	onRestore?(): void;
}

export function FindingCard({
	finding,
	handle,
	selected,
	onSelect,
	dimmed = false,
	onDrop,
	onRestore,
}: FindingCardProps) {
	const { anchor } = finding;
	const location = `${anchor.path}:${anchor.startLine}`;

	return (
		<article
			className={styles.card}
			data-finding-id={finding.id}
			data-selected={selected ? "true" : "false"}
			data-dimmed={dimmed ? "true" : "false"}
		>
			<header className={styles.header}>
				<button type="button" className={styles.handle} onClick={onSelect}>
					{handle}
				</button>
				<Link
					className={styles.location}
					to={`/diff?file=${encodeURIComponent(anchor.path)}&finding=${finding.id}`}
				>
					{location}
				</Link>
				{finding.category !== null && (
					<span className={styles.category}>{finding.category}</span>
				)}
				{finding.confidence !== null && (
					<span
						className={styles.confidence}
						data-confidence={finding.confidence}
					>
						{finding.confidence} confidence
					</span>
				)}
			</header>

			{finding.title !== null && (
				<h3 className={styles.title}>{finding.title}</h3>
			)}
			<p className={styles.body}>{finding.body}</p>

			<footer className={styles.footer}>
				{/*
					Dismissing is never deletion: it moves the comment to the dismissed
					lane, where it stays recoverable and where the next review pass
					reads it as a suppression.
				*/}
				{onDrop !== undefined && (
					<button type="button" className={styles.action} onClick={onDrop}>
						Dismiss
					</button>
				)}
				{onRestore !== undefined && (
					<button type="button" className={styles.action} onClick={onRestore}>
						Restore
					</button>
				)}
				{/*
					Two honesty markers, both of which the reader needs before acting:
					a claim whose citations were not all actually read, and a claim
					whose code moved since it was made.
				*/}
				{finding.groundingVerified === false && (
					<span className={styles.warn}>
						Not all cited files were read — treat as a lead
					</span>
				)}
				{finding.touchedByDelta && (
					<span className={styles.warn}>
						The code under this changed since it was written
					</span>
				)}
				{finding.anchorStatus !== "anchored" && (
					<span className={styles.warn}>anchor: {finding.anchorStatus}</span>
				)}
			</footer>
		</article>
	);
}
