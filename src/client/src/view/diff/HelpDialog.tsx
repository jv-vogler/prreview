import { Dialog } from "../general/Dialog";
import styles from "./HelpDialog.module.css";

export interface HelpDialogProps {
	open: boolean;
	onOpenChange(open: boolean): void;
}

const KEY_ROWS: ReadonlyArray<{ keys: string[]; label: string }> = [
	{ keys: ["j", "k"], label: "Next / previous file" },
	{ keys: ["n", "p"], label: "Next / previous hunk" },
	{ keys: ["v"], label: "Mark current hunk reviewed" },
	{ keys: ["m"], label: "Mark current file reviewed" },
	{ keys: ["s"], label: "Toggle split / unified view" },
	{ keys: ["?"], label: "This help" },
];

/** The `?` keymap reference (TASK-050). */
export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
	return (
		<Dialog title="Keyboard shortcuts" open={open} onOpenChange={onOpenChange}>
			<dl className={styles.list}>
				{KEY_ROWS.map((row) => (
					<div key={row.label} className={styles.row}>
						<dt className={styles.keys}>
							{row.keys.map((key) => (
								<kbd key={key} className={styles.key}>
									{key}
								</kbd>
							))}
						</dt>
						<dd className={styles.label}>{row.label}</dd>
					</div>
				))}
			</dl>
		</Dialog>
	);
}
