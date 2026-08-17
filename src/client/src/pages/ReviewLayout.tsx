import { Suspense, useMemo, useRef, useState } from "react";
import { Outlet, useSearchParams } from "react-router";
import { sortFilesByAttention } from "../domain/changeset/sortFilesByAttention";
import { AnalysisProvider } from "../view/analysis/AnalysisProvider";
import { AppShell } from "../view/app/AppShell";
import { TabBar } from "../view/app/TabBar";
import { TopBar } from "../view/app/TopBar";
import { WorkerPoolHost } from "../view/app/WorkerPoolHost";
import { ChatDock } from "../view/chat/ChatDock";
import { ChatProvider } from "../view/chat/ChatProvider";
import { CoverageProvider } from "../view/coverage/CoverageProvider";
import type { DiffCursor } from "../view/diff/DiffNavigationProvider";
import { DiffNavigationProvider } from "../view/diff/DiffNavigationProvider";
import { HelpDialog } from "../view/diff/HelpDialog";
import { useDiffStyle } from "../view/diff/useDiffStyle";
import { useGuaranteedChangeset } from "../view/diff/useGuaranteedChangeset";
import { useKeymap } from "../view/diff/useKeymap";
import { LoadingScreen } from "../view/general/LoadingScreen";
import { ChangesDetectedBanner } from "../view/session/ChangesDetectedBanner";
import { useDriftBanner } from "../view/session/useDriftBanner";
import { useFeatureFlags } from "../view/session/useFeatureFlags";
import { ViewerOnlyNotice } from "../view/session/ViewerOnlyNotice";
import { cursorFromSearchParams } from "./diffUrl";

/**
 * The layout every tab renders inside.
 *
 * It owns everything that must survive a tab switch — the session and
 * changeset gate, coverage, analysis, chat, the diff cursor, the run tray, the
 * drift banner, and the highlight worker pool. Anything held below this line
 * would be rebuilt on every switch, and for the worker pool that is not merely
 * wasteful: the pool is a singleton that terminates when its last provider
 * unmounts, so leaving it inside the diff would kill four workers every time
 * the reader looked at Understanding.
 */
export function ReviewLayout() {
	return (
		<Suspense fallback={<LoadingScreen />}>
			<ReviewLayoutContent />
		</Suspense>
	);
}

function ReviewLayoutContent() {
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
						<WorkerPoolHost>
							<ReviewFrame />
						</WorkerPoolHost>
					</DiffNavigationProvider>
				</ChatProvider>
			</AnalysisProvider>
		</CoverageProvider>
	);
}

function ReviewFrame() {
	const [diffStyle, toggleDiffStyle] = useDiffStyle();
	const [helpOpen, setHelpOpen] = useState(false);
	const [chatOpen, setChatOpen] = useState(false);
	const flags = useFeatureFlags();
	const drift = useDriftBanner();

	// The chat toggle is owned here rather than by a tab, so a question asked
	// while reading the diff is still open after switching to Understanding.
	useKeymap({
		dialogOpen: helpOpen,
		onAction: (action) => {
			if (action === "toggle-chat" && flags.chat) {
				setChatOpen((open) => !open);
			}
		},
	});

	return (
		<AppShell
			topBar={
				<>
					<TopBar
						diffStyle={diffStyle}
						onToggleDiffStyle={toggleDiffStyle}
						onOpenHelp={() => setHelpOpen(true)}
					/>
					<TabBar />
				</>
			}
			banner={
				<>
					{drift.driftDetected && (
						<ChangesDetectedBanner
							refreshing={drift.refreshing}
							onRefresh={drift.refresh}
						/>
					)}
					<ViewerOnlyNotice />
				</>
			}
			workspace={
				<>
					<Suspense fallback={<LoadingScreen />}>
						<Outlet context={{ diffStyle, toggleDiffStyle }} />
					</Suspense>
					<HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
				</>
			}
			dock={
				flags.chat && chatOpen ? (
					<ChatDock onClose={() => setChatOpen(false)} />
				) : undefined
			}
		/>
	);
}

/** what every tab can read from the layout */
export interface ReviewOutletContext {
	diffStyle: ReturnType<typeof useDiffStyle>[0];
	toggleDiffStyle: ReturnType<typeof useDiffStyle>[1];
}
