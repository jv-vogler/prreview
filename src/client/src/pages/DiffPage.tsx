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
			<aside className={styles.sidebar}>
				<FileTreePanel />
			</aside>
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
 * The findings pass, where its output lands — and honest about not being ready.
 *
 * The trigger used to be a tab of its own. The pass works end to end, but its
 * output is not good enough to put in front of someone yet, and a tab you
 * cannot use is worse than no tab: a standing invitation to click something
 * that goes nowhere. Disabled and labelled beats hidden, because hidden also
 * hides the plan.
 */
function ReviewToolbar() {
	return (
		<div className={styles.toolbar}>
			<button type="button" className={styles.review} disabled>
				Review this change
			</button>
			<span className={styles.reviewNote}>
				Not ready yet — suggested review comments are being reworked. Findings
				appear here in the margin once this is switched on.
			</span>
		</div>
	);
}
