import { NavLink } from "react-router";
import { useFeatureFlags } from "../session/useFeatureFlags";
import styles from "./TabBar.module.css";

/**
 * The two surfaces, and the promise each one makes about spending.
 *
 * Understanding first, because reading what a change is for before reading its
 * diff is the whole shape of the tool. The diff is free and always present.
 *
 * Suggested comments was a third tab and is not one now. The findings pass is
 * being reworked, and a tab you cannot use is worse than no tab: it is a
 * standing invitation to click something that goes nowhere. The pass is
 * triggered from the diff instead — where its output lands — and is plainly
 * marked as not ready. Nothing about the findings code was deleted.
 *
 * With no agent installed the AI tab is **absent**, not disabled. A disabled
 * control says "you could have this"; absence says "this build does not do
 * that", which is the truth when there is no agent to do it.
 */

interface Tab {
	to: string;
	label: string;
	/** false when the tab needs an agent this install does not have */
	alwaysAvailable: boolean;
}

const TABS: Tab[] = [
	{ to: "/understand", label: "Understanding", alwaysAvailable: false },
	{ to: "/diff", label: "Diff", alwaysAvailable: true },
];

export function TabBar() {
	const flags = useFeatureFlags();
	const visible = TABS.filter((tab) => tab.alwaysAvailable || flags.analysis);

	return (
		<nav className={styles.tabs} aria-label="Review surfaces">
			{visible.map((tab) => (
				<NavLink
					key={tab.to}
					to={tab.to}
					className={({ isActive }) =>
						isActive ? `${styles.tab} ${styles.active}` : styles.tab
					}
					data-tab={tab.to.slice(1)}
				>
					{tab.label}
				</NavLink>
			))}
		</nav>
	);
}
