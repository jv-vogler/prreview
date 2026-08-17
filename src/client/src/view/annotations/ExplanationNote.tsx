import { BookIcon } from "@primer/octicons-react";
import type {
	Explanation,
	ExplanationKind,
} from "../../domain/annotation/Annotation";
import styles from "./ExplanationNote.module.css";

export interface ExplanationNoteProps {
	note: Explanation;
}

/** the product's own words for what an explanation is about (PRODUCT §5) */
const KIND_LABEL: Record<ExplanationKind, string> = {
	intent: "Intent",
	mechanism: "Mechanism",
	implication: "Implication",
};

const MOVED_EXPLANATION =
	"The code this note describes moved and was matched approximately, so it may sit a line or two off.";

/**
 * A comprehension note in the margin of the diff (F3).
 *
 * The visual contract matters as much as the text: an explanation must not read
 * as a review comment, or the reader learns to skim past both. So it is a
 * hairline strip on a muted surface rather than a bubble — no avatar, no accent
 * rail, no rounded card, and **no buttons at all**, because there is nothing to
 * accept or dismiss. It states what the change is doing and gets out of the way.
 *
 * A note whose code was matched only approximately says so; one whose code is
 * gone is not rendered here at all (`UnanchoredTray`), because a note on the
 * wrong lines costs more trust than a note in a tray.
 */
export function ExplanationNote({ note }: ExplanationNoteProps) {
	const label = note.kind === null ? null : KIND_LABEL[note.kind];

	return (
		<aside
			className={styles.note}
			data-annotation-id={note.id}
			data-annotation-species="explanation"
			data-anchor-status={note.anchorStatus}
			aria-label={label === null ? "Explanation" : `Explanation: ${label}`}
		>
			<span className={styles.icon} aria-hidden="true">
				<BookIcon size={16} />
			</span>
			<div className={styles.content}>
				{(label !== null || note.anchorStatus === "fuzzy") && (
					<p className={styles.meta}>
						{label !== null && <span className={styles.kind}>{label}</span>}
						{note.anchorStatus === "fuzzy" && (
							<span className={styles.moved} title={MOVED_EXPLANATION}>
								moved
							</span>
						)}
					</p>
				)}
				<p className={styles.body}>{note.body}</p>
			</div>
		</aside>
	);
}
