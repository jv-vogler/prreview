import type { FeatureFlags } from "../../domain/session/FeatureFlags";
import { Dialog } from "../general/Dialog";
import { useFeatureFlags } from "../session/useFeatureFlags";
import styles from "./HelpDialog.module.css";

export interface HelpDialogProps {
	open: boolean;
	onOpenChange(open: boolean): void;
}

interface KeyRow {
	keys: string[];
	label: string;
	/** listed only when this surface exists at all — see the flag note below */
	flag?: keyof FeatureFlags;
}

const KEY_ROWS: readonly KeyRow[] = [
	{ keys: ["j", "k"], label: "Next / previous file" },
	{ keys: ["n", "p"], label: "Next / previous hunk" },
	{ keys: ["]", "["], label: "Next / previous note", flag: "analysis" },
	{ keys: ["v"], label: "Mark current hunk reviewed" },
	{ keys: ["m"], label: "Mark current file reviewed" },
	{ keys: ["c"], label: "Ask about this change", flag: "chat" },
	{ keys: ["s"], label: "Toggle split / unified view" },
	{ keys: ["g", "u"], label: "Go to Understanding", flag: "analysis" },
	{ keys: ["g", "d"], label: "Go back to the diff", flag: "analysis" },
	{ keys: ["?"], label: "This help" },
];

/**
 * The `?` keymap reference. Rows for surfaces that do not exist in this session
 * are left out rather than shown greyed: with no agent installed, advertising a
 * walkthrough key would be a lie, and F12 asks for absence, not disablement.
 */
export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
	const flags = useFeatureFlags();
	const rows = KEY_ROWS.filter(
		(row) => row.flag === undefined || flags[row.flag],
	);

	return (
		<Dialog title="Keyboard shortcuts" open={open} onOpenChange={onOpenChange}>
			<dl className={styles.list}>
				{rows.map((row) => (
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
