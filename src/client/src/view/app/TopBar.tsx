import {
	ColumnsIcon,
	FileDiffIcon,
	MilestoneIcon,
	MoonIcon,
	QuestionIcon,
	RowsIcon,
	SunIcon,
	TelescopeIcon,
} from "@primer/octicons-react";
import { Link, useLocation } from "react-router";
import { AnalyzeMenu } from "../analysis/AnalyzeMenu";
import type { DiffStyle } from "../diff/useDiffStyle";
import { Tooltip } from "../general/Tooltip";
import { useFeatureFlags } from "../session/useFeatureFlags";
import { useGuaranteedSession } from "../session/useGuaranteedSession";
import { useTheme } from "../styling/useTheme";
import { CoverageRing } from "./CoverageRing";
import styles from "./TopBar.module.css";

export interface TopBarProps {
	/** absent on pages with no diff to lay out, like `/orient` */
	diffStyle?: DiffStyle;
	onToggleDiffStyle?(): void;
	/**
	 * absent unless this page has a walkthrough to enter — the guided order is a
	 * mode over the diff, so only the diff page can offer it
	 */
	onToggleWalkthrough?(): void;
	walkthroughActive?: boolean;
	onOpenHelp(): void;
}

const THEME_MODE_LABEL = {
	light: "Theme: light",
	dark: "Theme: dark",
	auto: "Theme: auto",
} as const;

const ORIENT_PATH = "/orient";

/** The app header (TASK-047): what is under review, and how far along it is. */
export function TopBar({
	diffStyle,
	onToggleDiffStyle,
	onToggleWalkthrough,
	walkthroughActive = false,
	onOpenHelp,
}: TopBarProps) {
	const session = useGuaranteedSession();
	const { mode, resolvedTheme, cycleThemeMode } = useTheme();

	return (
		<header className={styles.bar}>
			<div className={styles.identity}>
				<span className={styles.wordmark}>prreview</span>
				<span className={styles.changeset} title={session.announce.resolved}>
					{session.changesetId}
				</span>
				{session.resumed && <span className={styles.resumed}>resumed</span>}
			</div>
			<div className={styles.controls}>
				<OrientationLink />
				{onToggleWalkthrough !== undefined && (
					<button
						type="button"
						className={styles.pageLink}
						onClick={onToggleWalkthrough}
						aria-pressed={walkthroughActive}
						title="Guided walkthrough (w)"
					>
						<MilestoneIcon size={16} />
						Walkthrough
					</button>
				)}
				<AnalyzeMenu />
				<CoverageRing percent={session.coverage.total} />
				{diffStyle !== undefined && onToggleDiffStyle !== undefined && (
					<Tooltip
						label={
							diffStyle === "unified"
								? "Switch to split view (s)"
								: "Switch to unified view (s)"
						}
					>
						<button
							type="button"
							className={styles.iconButton}
							onClick={onToggleDiffStyle}
							aria-label="Toggle split or unified diff"
						>
							{diffStyle === "unified" ? (
								<ColumnsIcon size={16} />
							) : (
								<RowsIcon size={16} />
							)}
						</button>
					</Tooltip>
				)}
				<Tooltip label={THEME_MODE_LABEL[mode]}>
					<button
						type="button"
						className={styles.iconButton}
						onClick={cycleThemeMode}
						aria-label={`Theme mode: ${mode}. Activate to change.`}
					>
						{resolvedTheme === "dark" ? (
							<MoonIcon size={16} />
						) : (
							<SunIcon size={16} />
						)}
					</button>
				</Tooltip>
				<Tooltip label="Keyboard shortcuts (?)">
					<button
						type="button"
						className={styles.iconButton}
						onClick={onOpenHelp}
						aria-label="Keyboard shortcuts"
					>
						<QuestionIcon size={16} />
					</button>
				</Tooltip>
			</div>
		</header>
	);
}

/**
 * The one crossing between the two pages, and only once there is an
 * orientation to cross to: whether an intent map exists is the server's answer
 * (`session.analysis`), not something the flags can say — a flag reports what
 * this session can ever do, availability changes every time a run lands.
 */
function OrientationLink() {
	const flags = useFeatureFlags();
	const session = useGuaranteedSession();
	const { pathname } = useLocation();

	if (!flags.analysis || !session.analysis.intentMapAvailable) {
		return null;
	}
	const onOrient = pathname === ORIENT_PATH;

	return (
		<Link
			className={styles.pageLink}
			to={onOrient ? "/diff" : ORIENT_PATH}
			title={onOrient ? "Back to the diff (g d)" : "Orientation (g o)"}
		>
			{onOrient ? <FileDiffIcon size={16} /> : <TelescopeIcon size={16} />}
			{onOrient ? "Diff" : "Orientation"}
		</Link>
	);
}
