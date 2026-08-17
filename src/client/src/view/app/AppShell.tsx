import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

export interface AppShellProps {
	topBar: ReactNode;
	banner?: ReactNode;
	/** absent on pages that are one column, like `/orient` */
	sidebar?: ReactNode;
	workspace: ReactNode;
	/** a strip under the workspace that never covers it: the walkthrough rail */
	workspaceFooter?: ReactNode;
	/** the right rail, when one is open: the chat dock */
	dock?: ReactNode;
}

/** The app's frame (TASK-047): header, optional banner strip, file panel, diff. */
export function AppShell({
	topBar,
	banner,
	sidebar,
	workspace,
	workspaceFooter,
	dock,
}: AppShellProps) {
	return (
		<div className={styles.shell}>
			{topBar}
			{banner}
			<div className={styles.body}>
				{sidebar !== undefined && (
					<aside className={styles.sidebar}>{sidebar}</aside>
				)}
				<main className={styles.workspace}>
					<div className={styles.workspaceMain}>{workspace}</div>
					{workspaceFooter}
				</main>
				{dock}
			</div>
		</div>
	);
}
