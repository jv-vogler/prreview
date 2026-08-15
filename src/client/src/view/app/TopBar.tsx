import {
	ColumnsIcon,
	MoonIcon,
	QuestionIcon,
	RowsIcon,
	SunIcon,
} from "@primer/octicons-react";
import type { DiffStyle } from "../diff/useDiffStyle";
import { Tooltip } from "../general/Tooltip";
import { useGuaranteedSession } from "../session/useGuaranteedSession";
import { useTheme } from "../styling/useTheme";
import { CoverageRing } from "./CoverageRing";
import styles from "./TopBar.module.css";

export interface TopBarProps {
	diffStyle: DiffStyle;
	onToggleDiffStyle(): void;
	onOpenHelp(): void;
}

const THEME_MODE_LABEL = {
	light: "Theme: light",
	dark: "Theme: dark",
	auto: "Theme: auto",
} as const;

/** The app header (TASK-047): what is under review, and how far along it is. */
export function TopBar({
	diffStyle,
	onToggleDiffStyle,
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
				<CoverageRing percent={session.coverage.total} />
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
