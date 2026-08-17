import { AlertIcon, CommentIcon } from "@primer/octicons-react";
import type { Annotation } from "../../domain/annotation/Annotation";
import styles from "./FindingBalloon.module.css";
import { useFindingSelection } from "./FindingSelectionProvider";

/**
 * A finding in the diff margin — what this change might warrant saying.
 *
 * Deliberately shaped like a pending review comment, because that is what it
 * is: a bubble with a body you could paste. That is the opposite of the
 * treatment explanations used to get here, and the difference is the point —
 * the margin now holds only things a person might actually send, so a reader
 * stops learning to skim it.
 *
 * Selection is read from context rather than closed over by the renderer's
 * `renderAnnotation` callback, which is itself a memo dependency: closing over
 * it silently produces either a stale highlight or a full re-render of every
 * balloon on every click.
 */

export interface FindingBalloonProps {
	note: Annotation;
}

export function FindingBalloon({ note }: FindingBalloonProps) {
	const selection = useFindingSelection();
	const related = note.species === "related-finding";
	const selected = selection.selectedId === note.id;

	return (
		<aside
			className={styles.balloon}
			data-annotation-id={note.id}
			data-species={note.species}
			data-selected={selected ? "true" : "false"}
		>
			<header className={styles.header}>
				<span className={styles.icon} aria-hidden="true">
					{related ? <AlertIcon size={12} /> : <CommentIcon size={12} />}
				</span>
				<span className={styles.species}>
					{related ? "Pre-existing, not from this change" : "Suggested comment"}
				</span>
				{note.touchedByDelta && (
					<span className={styles.stale}>code changed since</span>
				)}
			</header>
			{note.title !== null && <p className={styles.title}>{note.title}</p>}
			<p className={styles.body}>{note.body}</p>
			<button
				type="button"
				className={styles.select}
				onClick={() => selection.select(note.id)}
			>
				{selected ? "Deselect" : "Focus"}
			</button>
		</aside>
	);
}

/**
 * Findings whose anchor no longer resolves.
 *
 * They are shown grouped at the top of the file rather than dropped, because a
 * finding that was true when written does not stop mattering because the lines
 * moved — but they are visibly separated, because a comment pointing at the
 * wrong lines costs more trust than one in a list.
 */
export function FindingBalloonGroup({
	notes,
}: {
	notes: readonly Annotation[];
}) {
	return (
		<aside className={styles.group}>
			<p className={styles.groupLabel}>
				{notes.length === 1
					? "1 comment whose lines are gone"
					: `${notes.length} comments whose lines are gone`}
			</p>
			{notes.map((note) => (
				<FindingBalloon key={note.id} note={note} />
			))}
		</aside>
	);
}
