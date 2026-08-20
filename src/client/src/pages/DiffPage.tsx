import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	Link,
	useNavigate,
	useOutletContext,
	useSearchParams,
} from "react-router";
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
import { SidebarResizer } from "../view/diff/SidebarResizer";
import { useKeymap } from "../view/diff/useKeymap";
import { useSidebarWidth } from "../view/diff/useSidebarWidth";
import { useFindingSelection } from "../view/findings/FindingSelectionProvider";
import { useFeatureFlags } from "../view/session/useFeatureFlags";
import styles from "./DiffPage.module.css";
import {
	cursorFromSearchParams,
	findingFromSearchParams,
	searchParamsForCursor,
} from "./diffUrl";
import type { ReviewOutletContext } from "./ReviewLayout";

/**
 * `/diff` — the plain GitHub-style diff, free and always available.
 *
 * Findings appear here as balloons, and there is no longer a switch for that:
 * a review you paid for that renders only if you also find and flip a checkbox
 * is a review that is hidden by default. Explanations never appear here at all
 * — narration belongs beside the code it describes on the Understanding tab,
 * not scattered through the margin where a reader has to reassemble it.
 */
export function DiffPage() {
	const { diffStyle, toggleDiffStyle } =
		useOutletContext<ReviewOutletContext>();
	const navigation = useDiffNavigation();
	const { markReviewed } = useCoverageActions();
	const flags = useFeatureFlags();
	const navigate = useNavigate();
	const annotations = useAnnotations();
	const selection = useFindingSelection();
	const [searchParams] = useSearchParams();
	const sidebar = useSidebarWidth();

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
		/*
		 * `?finding=` selects the balloon the link was about.
		 *
		 * The comments tab has been emitting this parameter since findings
		 * shipped and nothing read it, so following a comment into the diff
		 * scrolled to roughly the right place and highlighted nothing. Selection
		 * is shared state precisely so a reader can cross between the list and
		 * the margin without losing which comment they were on.
		 */
		const finding = findingFromSearchParams(searchParams);
		if (finding !== null) {
			selection.focus(finding);
		}
	}, [searchParams, navigation.files, navigation.jumpTo, selection.focus]);

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
				case "go-diff":
					return undefined;
				case "go-comments":
					return navigate("/comments");
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
			}
		},
		[
			navigation,
			markReviewed,
			reviewedHunkIdsFor,
			toggleDiffStyle,
			jumpToStop,
			navigate,
		],
	);

	useKeymap({ dialogOpen: false, onAction: onKeyAction });

	return (
		<div className={styles.layout}>
			<aside className={styles.sidebar} style={{ width: sidebar.width }}>
				<FileTreePanel />
			</aside>
			<SidebarResizer width={sidebar.width} onWidth={sidebar.setWidth} />
			<div className={styles.main}>
				{flags.analysis && <ReviewToolbar />}
				<DiffWorkspace diffStyle={diffStyle} />
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

/**
 * A way to the findings pass from where its output lands.
 *
 * It defers rather than triggering: the depth choice belongs to the tab that
 * owns the pass, and a button here that silently picked one would be the same
 * mistake as the analysis button that once sat in the header — beside every tab
 * and belonging to none of them. This was a `disabled` button with no `onClick`
 * at all while the surface was pulled; it is a link now, and the tab does the
 * spending.
 */
function ReviewToolbar() {
	const annotations = useAnnotations();
	const hasFindings = annotations.some(
		(annotation) => annotation.species !== "explanation",
	);

	return (
		<div className={styles.toolbar}>
			<Link className={styles.review} to="/comments">
				{hasFindings ? "See suggested comments" : "Review this change"}
			</Link>
			<span className={styles.reviewNote}>
				{hasFindings
					? "The comments below in the margin, as a list you can triage."
					: "Findings appear here in the margin, and as a list on the Suggested comments tab."}
			</span>
		</div>
	);
}
