import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

export interface AppShellProps {
	topBar: ReactNode;
	banner?: ReactNode;
	sidebar: ReactNode;
	workspace: ReactNode;
}

/** The app's frame (TASK-047): header, optional banner strip, file panel, diff. */
export function AppShell({
	topBar,
	banner,
	sidebar,
	workspace,
}: AppShellProps) {
	return (
		<div className={styles.shell}>
			{topBar}
			{banner}
			<div className={styles.body}>
				<aside className={styles.sidebar}>{sidebar}</aside>
				<main className={styles.workspace}>{workspace}</main>
			</div>
		</div>
	);
}
