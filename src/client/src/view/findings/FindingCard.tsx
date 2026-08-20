import { Link } from "react-router";
import type {
	Citation,
	Finding,
	RelatedFinding,
} from "../../domain/annotation/Annotation";
import { diffPathFor } from "../../pages/diffUrl";
import styles from "./FindingCard.module.css";
import { findingMarkCopy } from "./findingMarkCopy";

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

function citationLocation(citation: Citation): string {
	if (citation.startLine === null) {
		return citation.path;
	}
	const end =
		citation.endLine === null || citation.endLine === citation.startLine
			? ""
			: `-${citation.endLine}`;
	return `${citation.path}:${citation.startLine}${end}`;
}

function citationKey(citation: Citation): string {
	return `${citation.path}:${citation.startLine ?? ""}:${citation.endLine ?? ""}`;
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
				{/*
					Through `diffPathFor`, because the diff addresses files by
					`file.id` and not by path: this link used to carry
					`?file=<path>`, which `cursorFromSearchParams` matched against
					nothing, so clicking a finding's location landed at the top of
					the diff. That module exists so "where a file lives in the URL"
					is decided once.
				*/}
				<Link
					className={styles.location}
					to={`${diffPathFor(anchor.fileId)}&finding=${finding.id}`}
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

			{/*
				What the finding points at besides where it sits. Worth showing:
				it is the difference between a claim about these lines and a claim
				about how these lines reach somewhere else.
			*/}
			{finding.citations.length > 0 && (
				<ul className={styles.citations}>
					{finding.citations.map((citation) => (
						<li key={citationKey(citation)}>
							<span className={styles.citationPath}>
								{citationLocation(citation)}
							</span>
							{citation.note !== null && ` — ${citation.note}`}
						</li>
					))}
				</ul>
			)}

			{/*
				Collapsed, and never open by default: a repro test can run to 800
				characters beside a 900-character body, and the body is the thing
				being read. It is an artifact, not an execution — nothing here runs
				it, which is also why `proof` has no mode that implies otherwise.
			*/}
			{finding.reproTest !== null && (
				<details className={styles.repro}>
					<summary>A test that would fail today</summary>
					<pre>
						<code>{finding.reproTest}</code>
					</pre>
				</details>
			)}

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
					The honesty markers, and they are specific now.

					Adjudication works out exactly which citation failed and why a
					claim is hedged, and all of that used to be dropped on the way
					to the store, so this card substituted one generic sentence for
					every reason. The generic line survives only as the fallback for
					a stamp lost with no particular citation to blame — which is what
					a reword produces.
				*/}
				{finding.marks.map((mark) => (
					<span key={mark.kind} className={styles.warn}>
						{findingMarkCopy(mark)}
					</span>
				))}
				{finding.groundingVerified === false && finding.marks.length === 0 && (
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
