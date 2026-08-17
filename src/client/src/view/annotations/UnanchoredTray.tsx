import { UnlinkIcon } from "@primer/octicons-react";
import type { Explanation } from "../../domain/annotation/Annotation";
import styles from "./UnanchoredTray.module.css";

export interface UnanchoredTrayProps {
	notes: readonly Explanation[];
}

/**
 * The file's notes whose code is gone (ARCHITECTURE §6, step 6). They are kept
 * and shown here rather than placed at a plausible-looking line, because a note
 * on the wrong lines is the one failure mode re-anchoring exists to prevent
 * (RISK-007).
 */
export function UnanchoredTray({ notes }: UnanchoredTrayProps) {
	if (notes.length === 0) {
		return null;
	}
	return (
		<section className={styles.tray} aria-label="Notes without a place">
			<p className={styles.heading}>
				<span className={styles.icon} aria-hidden="true">
					<UnlinkIcon size={16} />
				</span>
				{notes.length === 1
					? "One note describes code that is no longer in this file."
					: `${notes.length} notes describe code that is no longer in this file.`}
			</p>
			<ul className={styles.list}>
				{notes.map((note) => (
					<li key={note.id} className={styles.body}>
						{note.body}
					</li>
				))}
			</ul>
		</section>
	);
}
