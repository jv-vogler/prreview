import type { ChatMessageContextDto } from "@dto/ChatMessageDto";
import { FileIcon } from "@primer/octicons-react";
import styles from "./ContextChip.module.css";

export interface ContextChipProps {
	context: ChatMessageContextDto;
	/** which hunk of the file, 1-based, when the reader is inside one */
	hunkPosition?: { index: number; total: number };
}

const FRAMING_EXPLANATION =
	"Your question is asked about this file and hunk. Move in the diff to ask about somewhere else.";

/**
 * What the next question will be framed with (F8's context-awareness).
 *
 * On screen because the framing is invisible otherwise: the answer to "why is
 * this safe?" depends entirely on what "this" was, and a reader who cannot see
 * what prreview thinks they are looking at cannot trust the answer. It moves
 * with the cursor, so it doubles as a readout of where the reader is.
 *
 * The file name never truncates and the directories above it do: in a dock this
 * narrow, `…/ChatDock.tsx` identifies the file and `src/client/src/vi…` does not.
 */
export function ContextChip({ context, hunkPosition }: ContextChipProps) {
	if (context.file === undefined) {
		return (
			<p className={styles.chip} title={FRAMING_EXPLANATION}>
				Asking about the whole change
			</p>
		);
	}

	const lastSeparator = context.file.lastIndexOf("/");
	const directories = context.file.slice(0, lastSeparator + 1);
	const name = context.file.slice(lastSeparator + 1);

	return (
		<p className={styles.chip} title={FRAMING_EXPLANATION}>
			<span className={styles.icon} aria-hidden="true">
				<FileIcon size={16} />
			</span>
			<span className={styles.path}>
				<span className={styles.directories}>{directories}</span>
				<span className={styles.name}>{name}</span>
			</span>
			{hunkPosition !== undefined && (
				<span className={styles.hunk}>
					hunk {hunkPosition.index} of {hunkPosition.total}
				</span>
			)}
		</p>
	);
}
