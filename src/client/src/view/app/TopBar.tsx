import type { ChangesetSourceDto } from "@dto/ChangesetDto";
import {
	ColumnsIcon,
	LinkExternalIcon,
	MoonIcon,
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
	/** absent on pages with no diff to lay out */
	diffStyle?: DiffStyle;
	onToggleDiffStyle?(): void;
}

const THEME_MODE_LABEL = {
	light: "Theme: light",
	dark: "Theme: dark",
	auto: "Theme: auto",
} as const;

/**
 * The app header: what is under review, and how far along it is.
 *
 * Deliberately not a place to spend money. The analysis trigger used to live
 * here, which meant the same button appeared beside every tab and belonged to
 * none of them — a reader on the Diff tab was being offered a pass they had not
 * navigated to. Each pass is now triggered from inside the tab it fills, where
 * the invitation can say what it costs and what it produces.
 */
export function TopBar({ diffStyle, onToggleDiffStyle }: TopBarProps) {
	const session = useGuaranteedSession();
	const { mode, resolvedTheme, cycleThemeMode } = useTheme();
	const href = sourceUrl(session.source);

	return (
		<header className={styles.bar}>
			<div className={styles.identity}>
				<span className={styles.wordmark}>prreview</span>
				{href === null ? (
					<span className={styles.changeset} title={session.announce.resolved}>
						{session.changesetId}
					</span>
				) : (
					<a
						className={styles.changesetLink}
						href={href}
						target="_blank"
						rel="noreferrer"
						title={`${session.announce.resolved} — open on GitHub`}
					>
						{session.changesetId}
						<LinkExternalIcon size={12} />
					</a>
				)}
				{session.resumed && <span className={styles.resumed}>resumed</span>}
			</div>
			<div className={styles.controls}>
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
				{/*
					No shortcuts button. The keymap still works and `?` still opens the
					dialog — what is gone is the icon advertising it, because a header
					control that only opens a reference is one more thing to look past
					on a screen whose job is the change.
				*/}
			</div>
		</header>
	);
}

/**
 * The change, where it lives on the web.
 *
 * Only pull requests get one, because only a pull request has an address that
 * exists outside this machine. A branch, a commit range, and the working tree
 * are local facts, and inventing a URL for them would send the reader somewhere
 * that may not exist.
 */
function sourceUrl(source: ChangesetSourceDto): string | null {
	if (source.kind !== "pr") {
		return null;
	}
	return `https://github.com/${source.repo}/pull/${source.number}`;
}
