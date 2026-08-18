import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router";
import {
	annotationStops,
	nextAnnotationStop,
} from "../domain/annotation/annotationStops";
import { useAnnotations } from "../view/annotations/useAnnotations";
import { useCoverageActions } from "../view/coverage/CoverageProvider";
import { useDiffNavigation } from "../view/diff/DiffNavigationProvider";
import { DiffWorkspace } from "../view/diff/DiffWorkspace";
import { FileTreePanel } from "../view/diff/FileTreePanel";
import type { KeyAction } from "../view/diff/resolveKeyAction";
import { useKeymap } from "../view/diff/useKeymap";
import { useFeatureFlags } from "../view/session/useFeatureFlags";
import styles from "./DiffPage.module.css";
import { cursorFromSearchParams, searchParamsForCursor } from "./diffUrl";
import type { ReviewOutletContext } from "./ReviewLayout";

/**
 * `/diff` — the plain GitHub-style diff, free and always available.
 *
 * Findings appear here as balloons behind a toggle; explanations never do.
 * Narration belongs beside the code it describes on the Understanding tab, not
 * scattered through the margin where a reader has to reassemble it.
 */
export function DiffPage() {
	const { diffStyle, toggleDiffStyle } =
		useOutletContext<ReviewOutletContext>();
	const navigation = useDiffNavigation();
	const { markReviewed } = useCoverageActions();
	const [showFindings, setShowFindings] = useState(true);
	const flags = useFeatureFlags();
	const navigate = useNavigate();
	const annotations = useAnnotations();
	const [searchParams] = useSearchParams();

	const stops = useMemo(
		() => annotationStops(annotations, navigation.files),
		[annotations, navigation.files],
	);

	useCursorUrlSync();

	// restore the URL's position once the workspace has registered its scroll
	// executor (child effects run before this one)
	const restoredRef = useRef(false);
	useEffect(() => {
		if (restoredRef.current) {
			return;
		}
		restoredRef.current = true;
		const initial = cursorFromSearchParams(searchParams, navigation.files);
		if (initial !== undefined) {
			navigation.jumpTo(initial);
		}
	}, [searchParams, navigation.files, navigation.jumpTo]);

	const reviewedHunkIdsFor = useCallback(
		(scope: "hunk" | "file") => {
			const file = navigation.files[navigation.cursor.fileIndex];
			if (file === undefined) {
				return [];
			}
			if (scope === "file") {
				return file.hunks.map((hunk) => hunk.id);
			}
			const hunkId = file.hunks[navigation.cursor.hunkIndex]?.id;
			return hunkId === undefined ? [] : [hunkId];
		},
		[navigation.files, navigation.cursor],
	);

	const jumpToStop = useCallback(
		(direction: "next" | "previous") => {
			const stop = nextAnnotationStop(stops, navigation.cursor, direction);
			if (stop !== null) {
				navigation.jumpTo(stop);
			}
		},
		[stops, navigation.cursor, navigation.jumpTo],
	);

	const onKeyAction = useCallback(
		(action: KeyAction) => {
			switch (action) {
				case "next-annotation":
					return jumpToStop("next");
				case "prev-annotation":
					return jumpToStop("previous");
				case "go-understand":
					return navigate("/understand");
				case "go-comments":
					return navigate("/comments");
				case "go-diff":
					return undefined;
				case "next-file":
					return navigation.nextFile();
				case "prev-file":
					return navigation.prevFile();
				case "next-hunk":
					return navigation.nextHunk();
				case "prev-hunk":
					return navigation.prevHunk();
				case "mark-hunk-reviewed":
					return markReviewed(reviewedHunkIdsFor("hunk"));
				case "mark-file-reviewed":
					return markReviewed(reviewedHunkIdsFor("file"));
				case "toggle-diff-style":
					return toggleDiffStyle();
				case "toggle-findings":
					// absent, not disabled, without an agent: the key belongs to the
					// surface, and with no agent there is no surface
					return flags.analysis
						? setShowFindings((shown) => !shown)
						: undefined;
			}
		},
		[
			navigation,
			markReviewed,
			reviewedHunkIdsFor,
			toggleDiffStyle,
			jumpToStop,
			navigate,
			flags.analysis,
		],
	);

	useKeymap({ dialogOpen: false, onAction: onKeyAction });

	return (
		<div className={styles.layout}>
			<aside className={styles.sidebar}>
				<FileTreePanel />
			</aside>
			<div className={styles.main}>
				{flags.analysis && (
					<div className={styles.toolbar}>
						<label className={styles.toggle}>
							<input
								type="checkbox"
								checked={showFindings}
								onChange={(event) => setShowFindings(event.target.checked)}
							/>
							Show suggested comments in the diff
						</label>
					</div>
				)}
				<DiffWorkspace diffStyle={diffStyle} showFindings={showFindings} />
			</div>
		</div>
	);
}

function useCursorUrlSync(): void {
	const navigation = useDiffNavigation();
	const [, setSearchParams] = useSearchParams();
	const { files, cursor } = navigation;

	useEffect(() => {
		setSearchParams(
			(current) => searchParamsForCursor(current, files, cursor),
			{
				replace: true,
			},
		);
	}, [files, cursor, setSearchParams]);
}
