import { NavLink } from "react-router";
import { useFeatureFlags } from "../session/useFeatureFlags";
import styles from "./TabBar.module.css";

/**
 * The three surfaces, and the promise each one makes about spending.
 *
 * The diff is free and always present. Each AI tab is a separate, deliberate
 * trigger — nothing chains a second pass off the first, because "I clicked
 * Understanding and it also ran a review" is exactly the surprise that makes a
 * tool untrustworthy with someone's money.
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
