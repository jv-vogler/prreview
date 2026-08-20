import { NavLink } from "react-router";
import { useFeatureFlags } from "../session/useFeatureFlags";
import styles from "./TabBar.module.css";

/**
 * The three surfaces, and the promise each one makes about spending.
 *
 * Understanding first, because reading what a change is for before reading its
 * diff is the whole shape of the tool. The diff is free and always present.
 * Suggested comments is last because it is the most expensive, and it is a tab
 * again: it was pulled for a release while the pass's output was not good
 * enough to put in front of someone, and what made it not good enough was six
 * mechanisms computing something and dropping it rather than anything about the
 * prompts.
 *
 * With no agent installed the AI tabs are **absent**, not disabled. A disabled
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
	{ to: "/comments", label: "Suggested comments", alwaysAvailable: false },
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
