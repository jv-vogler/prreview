import { XIcon } from "@primer/octicons-react";
import { useState } from "react";
import { useFeatureFlags } from "./useFeatureFlags";
import styles from "./ViewerOnlyNotice.module.css";

const DISMISSED_KEY = "prreview.viewerOnlyNotice.dismissed";
const DISMISSED = "1";

/**
 * The one place the absence of an agent is explained (F12). Every other AI
 * surface is simply not there — nothing is greyed out, nothing hints at a
 * feature the reader cannot have — so this notice carries the whole story:
 * what is missing, what still works, and what to do about it.
 *
 * Dismissal sticks, because a reader who has no agent and does not want one
 * should not be told again on every run.
 */
export function ViewerOnlyNotice() {
	const flags = useFeatureFlags();
	const [dismissed, setDismissed] = useState(() => readDismissed());

	if (flags.analysis || dismissed) {
		return null;
	}

	const dismiss = () => {
		setDismissed(true);
		writeDismissed();
	};

	return (
		<div className={styles.notice} role="status">
			<p className={styles.text}>
				<strong className={styles.lead}>Viewer only.</strong> No agent CLI was
				found, so prreview is showing the diff without explaining it. The file
				tree, the diff, and coverage work as usual. For explanations, an intent
				map, a walkthrough, and chat: install{" "}
				<code className={styles.code}>claude</code>, sign in, and start prreview
				again.
			</p>
			<button
				type="button"
				className={styles.dismiss}
				onClick={dismiss}
				aria-label="Dismiss the viewer-only notice"
			>
				<XIcon size={16} />
			</button>
		</div>
	);
}

function readDismissed(): boolean {
	try {
		return window.localStorage.getItem(DISMISSED_KEY) === DISMISSED;
	} catch {
		// private mode and storage-blocking extensions throw on access; the
		// notice reappearing is a smaller failure than the app not rendering
		return false;
	}
}

function writeDismissed(): void {
	try {
		window.localStorage.setItem(DISMISSED_KEY, DISMISSED);
	} catch {
		// same: a dismissal that does not survive a reload is acceptable
	}
}
