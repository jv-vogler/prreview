import { SyncIcon } from "@primer/octicons-react";
import styles from "./ChangesDetectedBanner.module.css";

export interface ChangesDetectedBannerProps {
	refreshing: boolean;
	onRefresh(): void;
}

/**
 * Shown when the poller reports the reviewed code moved underneath the
 * session (F12). Deliberately calm: nothing reloads until the user asks.
 */
export function ChangesDetectedBanner({
	refreshing,
	onRefresh,
}: ChangesDetectedBannerProps) {
	return (
		<div className={styles.banner} role="status">
			<span>
				The changes under review have moved. Coverage carries over where hunks
				survived.
			</span>
			<button
				type="button"
				className={styles.refreshButton}
				onClick={onRefresh}
				disabled={refreshing}
			>
				<SyncIcon size={16} />
				{refreshing ? "Refreshing…" : "Refresh changeset"}
			</button>
		</div>
	);
}
