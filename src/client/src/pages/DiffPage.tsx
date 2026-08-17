import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
	annotationStops,
	nextAnnotationStop,
} from "../domain/annotation/annotationStops";
import { sortFilesByAttention } from "../domain/changeset/sortFilesByAttention";
import { AnalysisProvider } from "../view/analysis/AnalysisProvider";
import { AnalysisTray } from "../view/analysis/AnalysisTray";
import { useAnnotations } from "../view/annotations/useAnnotations";
import { AppShell } from "../view/app/AppShell";
import { TopBar } from "../view/app/TopBar";
import { ChatProvider } from "../view/chat/ChatProvider";
import {
	CoverageProvider,
	useCoverageActions,
} from "../view/coverage/CoverageProvider";
import type { DiffCursor } from "../view/diff/DiffNavigationProvider";
import {
	DiffNavigationProvider,
	useDiffNavigation,
} from "../view/diff/DiffNavigationProvider";
import { DiffWorkspace } from "../view/diff/DiffWorkspace";
import { FileTreePanel } from "../view/diff/FileTreePanel";
import { HelpDialog } from "../view/diff/HelpDialog";
import type { KeyAction } from "../view/diff/resolveKeyAction";
import { useDiffStyle } from "../view/diff/useDiffStyle";
import { useGuaranteedChangeset } from "../view/diff/useGuaranteedChangeset";
import { useKeymap } from "../view/diff/useKeymap";
import { LoadingScreen } from "../view/general/LoadingScreen";
import { ChangesDetectedBanner } from "../view/session/ChangesDetectedBanner";
import { useDriftBanner } from "../view/session/useDriftBanner";
import { ViewerOnlyNotice } from "../view/session/ViewerOnlyNotice";
import { cursorFromSearchParams, searchParamsForCursor } from "./diffUrl";

/** `/diff` — the review workspace behind the suspense gate (TASK-049/051). */
export function DiffPage() {
	return (
		<Suspense fallback={<LoadingScreen />}>
			<DiffPageContent />
		</Suspense>
	);
}

function DiffPageContent() {
	const changeset = useGuaranteedChangeset();
	const [searchParams] = useSearchParams();

	const sortedFiles = useMemo(
		() => sortFilesByAttention(changeset.files),
		[changeset.files],
	);

	// the URL is read once, at entry — afterwards the cursor writes the URL
	const initialCursorRef = useRef<DiffCursor | undefined>(undefined);
	const initialCursorReadRef = useRef(false);
	if (!initialCursorReadRef.current) {
		initialCursorReadRef.current = true;
		initialCursorRef.current = cursorFromSearchParams(
			searchParams,
			sortedFiles,
		);
	}

	return (
		<CoverageProvider>
			<AnalysisProvider>
				<ChatProvider>
					<DiffNavigationProvider
						files={sortedFiles}
						initialCursor={initialCursorRef.current}
					>
						<DiffPageBody initialCursor={initialCursorRef.current} />
					</DiffNavigationProvider>
				</ChatProvider>
			</AnalysisProvider>
		</CoverageProvider>
	);
}

interface DiffPageBodyProps {
	initialCursor: DiffCursor | undefined;
}

function DiffPageBody({ initialCursor }: DiffPageBodyProps) {
	const navigation = useDiffNavigation();
	const { markReviewed } = useCoverageActions();
	const [diffStyle, toggleDiffStyle] = useDiffStyle();
	const [helpOpen, setHelpOpen] = useState(false);
	const drift = useDriftBanner();
	const navigate = useNavigate();
	const annotations = useAnnotations();
	const stops = useMemo(
		() => annotationStops(annotations, navigation.files),
		[annotations, navigation.files],
	);

	useCursorUrlSync();

	// restore the URL's position once the workspace has registered its
	// scroll executor (child effects run before this one)
	const restoredRef = useRef(false);
	useEffect(() => {
		if (restoredRef.current || initialCursor === undefined) {
			return;
		}
		restoredRef.current = true;
		navigation.jumpTo(initialCursor);
	}, [initialCursor, navigation.jumpTo]);

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
			// `w` (walkthrough) and `c` (chat) resolve already and are answered by
			// the surfaces phase 9 builds; until then they do nothing
			switch (action) {
				case "next-annotation":
					return jumpToStop("next");
				case "prev-annotation":
					return jumpToStop("previous");
				case "go-orient":
					return navigate("/orient");
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
				case "open-help":
					return setHelpOpen(true);
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

	useKeymap({ dialogOpen: helpOpen, onAction: onKeyAction });

	return (
		<>
			<AppShell
				topBar={
					<TopBar
						diffStyle={diffStyle}
						onToggleDiffStyle={toggleDiffStyle}
						onOpenHelp={() => setHelpOpen(true)}
					/>
				}
				banner={
					<>
						{drift.driftDetected && (
							<ChangesDetectedBanner
								refreshing={drift.refreshing}
								onRefresh={drift.refresh}
							/>
						)}
						<AnalysisTray />
						<ViewerOnlyNotice />
					</>
				}
				sidebar={<FileTreePanel />}
				workspace={<DiffWorkspace diffStyle={diffStyle} />}
			/>
			<HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
		</>
	);
}

function useCursorUrlSync(): void {
	const navigation = useDiffNavigation();
	const [, setSearchParams] = useSearchParams();
	const { files, cursor } = navigation;

	useEffect(() => {
		setSearchParams(
			(current) => searchParamsForCursor(current, files, cursor),
			{ replace: true },
		);
	}, [files, cursor, setSearchParams]);
}
